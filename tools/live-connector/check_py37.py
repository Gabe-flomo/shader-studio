#!/usr/bin/env python3
"""Fails on Python syntax or standard-library names newer than Python 3.7.

Live 11 runs Remote Scripts on Python 3.7, Live 12 on 3.11, and we can only
test with whatever python3 is installed. This walks the given .py files and
folders and reports file:line: reason for anything 3.7 can't run. It also
requires every file to compile() under the running interpreter.

Usage: python3 check_py37.py PATH [PATH ...]   (exit 1 on any finding)
"""

import ast
import io
import os
import sys
import tokenize

BUILTIN_GENERICS = set(["list", "dict", "tuple", "set", "frozenset", "type"])

# Dotted names that appeared in 3.8 or later.
NEW_NAMES = {
    "math.prod": "math.prod is 3.8+",
    "math.isqrt": "math.isqrt is 3.8+",
    "math.dist": "math.dist is 3.8+",
    "math.comb": "math.comb is 3.8+",
    "math.perm": "math.perm is 3.8+",
    "functools.cached_property": "functools.cached_property is 3.8+",
    "functools.cache": "functools.cache is 3.9+",
    "importlib.metadata": "importlib.metadata is 3.8+",
    "typing.Literal": "typing.Literal is 3.8+",
    "typing.Final": "typing.Final is 3.8+",
    "typing.Protocol": "typing.Protocol is 3.8+",
    "typing.TypedDict": "typing.TypedDict is 3.8+",
    "typing.Annotated": "typing.Annotated is 3.9+",
    "typing.ParamSpec": "typing.ParamSpec is 3.10+",
    "graphlib": "graphlib is 3.9+",
    "zoneinfo": "zoneinfo is 3.9+",
    "asyncio.to_thread": "asyncio.to_thread is 3.9+",
    "shlex.join": "shlex.join is 3.8+",
    "statistics.fmean": "statistics.fmean is 3.8+",
    "itertools.pairwise": "itertools.pairwise is 3.10+",
}
NEW_METHODS = {
    "removeprefix": "str.removeprefix is 3.9+",
    "removesuffix": "str.removesuffix is 3.9+",
}


def _dotted(node):
    parts = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
        return ".".join(reversed(parts))
    return None


def _new_name(dotted):
    """The NEW_NAMES entry `dotted` is or starts with, if any."""
    for name, reason in NEW_NAMES.items():
        if dotted == name or dotted.startswith(name + "."):
            return reason
    return None


class _Visitor(ast.NodeVisitor):
    def __init__(self, source_lines, issues):
        self.lines = source_lines
        self.issues = issues
        self.aliases = {}  # local name -> module or dotted name

    def add(self, node, reason):
        self.issues.append((getattr(node, "lineno", 0), reason))

    # imports

    def visit_Import(self, node):
        for alias in node.names:
            reason = _new_name(alias.name)
            if reason:
                self.add(node, reason)
            local = alias.asname or alias.name.split(".")[0]
            self.aliases[local] = alias.name if alias.asname else alias.name.split(".")[0]
        self.generic_visit(node)

    def visit_ImportFrom(self, node):
        module = node.module or ""
        if node.level == 0:
            reason = _new_name(module)
            if reason:
                self.add(node, reason)
            for alias in node.names:
                full = module + "." + alias.name
                reason = _new_name(full)
                if reason:
                    self.add(node, reason)
                self.aliases[alias.asname or alias.name] = full
        self.generic_visit(node)

    # names

    def _resolve(self, dotted):
        head, _, rest = dotted.partition(".")
        if head in self.aliases:
            base = self.aliases[head]
            return base + ("." + rest if rest else "")
        return dotted

    def visit_Attribute(self, node):
        if node.attr in NEW_METHODS:
            self.add(node, NEW_METHODS[node.attr])
        dotted = _dotted(node)
        if dotted:
            reason = _new_name(self._resolve(dotted))
            if reason:
                self.add(node, reason)
                return  # don't report the inner parts again
        self.generic_visit(node)

    # syntax

    def visit_NamedExpr(self, node):
        self.add(node, "assignment expression (:=) is 3.8+")
        self.generic_visit(node)

    def _check_args(self, node):
        args = node.args
        if getattr(args, "posonlyargs", None):
            self.add(node, "positional-only parameters (/) are 3.8+")
        for a in list(getattr(args, "posonlyargs", [])) + list(args.args) + list(args.kwonlyargs) + \
                [x for x in (args.vararg, args.kwarg) if x is not None]:
            if a.annotation is not None:
                self._check_annotation(a.annotation)

    def _check_decorators(self, node):
        for dec in node.decorator_list:
            target = dec.func if isinstance(dec, ast.Call) else dec
            if _dotted(target) is None:
                self.add(dec, "decorator expressions beyond a dotted name are 3.9+")

    def visit_FunctionDef(self, node):
        self._check_args(node)
        self._check_decorators(node)
        if node.returns is not None:
            self._check_annotation(node.returns)
        self.generic_visit(node)

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_Lambda(self, node):
        if getattr(node.args, "posonlyargs", None):
            self.add(node, "positional-only parameters (/) are 3.8+")
        self.generic_visit(node)

    def visit_ClassDef(self, node):
        self._check_decorators(node)
        self.generic_visit(node)

    def visit_AnnAssign(self, node):
        self._check_annotation(node.annotation)
        self.generic_visit(node)

    def _check_annotation(self, ann):
        for sub in ast.walk(ann):
            if isinstance(sub, ast.BinOp) and isinstance(sub.op, ast.BitOr):
                self.add(sub, "X | Y type unions are 3.10+")
                break

    def visit_Subscript(self, node):
        if isinstance(node.value, ast.Name) and node.value.id in BUILTIN_GENERICS \
                and node.value.id not in self.aliases:
            self.add(node, "builtin generic %s[...] is 3.9+" % node.value.id)
        self.generic_visit(node)

    def visit_BinOp(self, node):
        if isinstance(node.op, ast.BitOr) and (_is_dict(node.left) or _is_dict(node.right)):
            self.add(node, "dict union (|) is 3.9+")
        self.generic_visit(node)

    def visit_AugAssign(self, node):
        if isinstance(node.op, ast.BitOr) and _is_dict(node.value):
            self.add(node, "dict union (|=) is 3.9+")
        self.generic_visit(node)

    def visit_Call(self, node):
        if isinstance(node.func, ast.Name) and node.func.id == "zip":
            for kw in node.keywords:
                if kw.arg == "strict":
                    self.add(node, "zip(strict=...) is 3.10+")
        self.generic_visit(node)

    def _starred_tuple_unparenthesized(self, value):
        if not isinstance(value, ast.Tuple):
            return False
        if not any(isinstance(e, ast.Starred) for e in value.elts):
            return False
        line = self.lines[value.lineno - 1] if 0 < value.lineno <= len(self.lines) else ""
        return line[value.col_offset:value.col_offset + 1] != "("

    def visit_Return(self, node):
        if node.value is not None and self._starred_tuple_unparenthesized(node.value):
            self.add(node, "unparenthesized *unpacking in return is 3.8+")
        self.generic_visit(node)

    def visit_Yield(self, node):
        if node.value is not None and self._starred_tuple_unparenthesized(node.value):
            self.add(node, "unparenthesized *unpacking in yield is 3.8+")
        self.generic_visit(node)

    def generic_visit(self, node):
        name = type(node).__name__
        if name in ("Match", "match_case"):
            self.add(node, "match statements are 3.10+")
        elif name == "TryStar":
            self.add(node, "except* is 3.11+")
        elif name in ("TypeAlias", "TypeVar", "ParamSpec", "TypeVarTuple"):
            self.add(node, "type parameter syntax is 3.12+")
        ast.NodeVisitor.generic_visit(self, node)


def _is_dict(node):
    if isinstance(node, (ast.Dict, ast.DictComp)):
        return True
    return isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "dict"


# ---------------------------------------------------------------- token checks

def _fstring_debug_specifier(token_text):
    """True when an f-string token uses the self-documenting {expr=} form."""
    i = 0
    while i < len(token_text) and token_text[i] in "rRbBuUfF":
        i += 1
    prefix = token_text[:i].lower()
    if "f" not in prefix:
        return False
    body = token_text[i:]
    for quote in ('"""', "'''", '"', "'"):
        if body.startswith(quote) and body.endswith(quote) and len(body) >= 2 * len(quote):
            body = body[len(quote):-len(quote)]
            break
    return _scan_fields(body)


def _scan_fields(body):
    i = 0
    n = len(body)
    while i < n:
        c = body[i]
        if c == "{":
            if i + 1 < n and body[i + 1] == "{":
                i += 2
                continue
            end, found = _scan_expression(body, i + 1)
            if found:
                return True
            i = end
            continue
        i += 1
    return False


def _scan_expression(body, i):
    """Scans one replacement field's expression starting at i. Returns
    (index after the field, found a debug '=')."""
    n = len(body)
    depth = 0
    quote = None
    while i < n:
        c = body[i]
        if quote:
            if c == "\\":
                i += 2
                continue
            if body.startswith(quote, i):
                i += len(quote)
                quote = None
                continue
            i += 1
            continue
        if c in "'\"":
            quote = c
            i += 1
            continue
        if c in "([{":
            depth += 1
        elif c in ")]}":
            if depth == 0:
                return i + 1, False  # '}' closes the field
            depth -= 1
        elif depth == 0 and c == "=":
            prev = body[i - 1] if i > 0 else ""
            nxt = body[i + 1] if i + 1 < n else ""
            if prev not in "=!<>" and nxt != "=":
                rest = body[i + 1:].lstrip()
                if rest[:1] in ("}", "!", ":"):
                    return i + 1, True
        elif depth == 0 and c == "!" and (i + 1 < n and body[i + 1] != "="):
            return _skip_field(body, i), False
        elif depth == 0 and c == ":":
            return _skip_field(body, i), False
        i += 1
    return i, False


def _skip_field(body, i):
    # Skip a conversion / format spec (which may hold nested {fields}).
    depth = 0
    n = len(body)
    while i < n:
        c = body[i]
        if c == "{":
            depth += 1
        elif c == "}":
            if depth == 0:
                return i + 1
            depth -= 1
        i += 1
    return i


def _token_issues(source):
    issues = []
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(source).readline))
    except (tokenize.TokenError, SyntaxError, IndentationError):
        return issues
    for idx, tok in enumerate(tokens):
        if tok.type == tokenize.STRING and _fstring_debug_specifier(tok.string):
            issues.append((tok.start[0], "f-string '=' self-documenting specifier is 3.8+"))
    return issues


def _with_issues(tree, source):
    """Parenthesized multi-item `with (a as b, c as d):` is 3.9+ (official 3.10)."""
    issues = []
    try:
        tokens = [t for t in tokenize.generate_tokens(io.StringIO(source).readline)
                  if t.type not in (tokenize.NL, tokenize.COMMENT)]
    except (tokenize.TokenError, SyntaxError, IndentationError):
        return issues
    by_pos = {}
    for idx, tok in enumerate(tokens):
        by_pos[tok.start] = idx
    for node in ast.walk(tree):
        if not isinstance(node, (ast.With, ast.AsyncWith)) or len(node.items) < 2:
            continue
        idx = by_pos.get((node.lineno, node.col_offset))
        if idx is None:
            continue
        if tokens[idx].string == "async":
            idx += 1
        if idx + 1 >= len(tokens) or tokens[idx].string != "with" or tokens[idx + 1].string != "(":
            continue
        depth = 0
        j = idx + 1
        while j < len(tokens):
            s = tokens[j].string
            if tokens[j].type == tokenize.OP and s in "([{":
                depth += 1
            elif tokens[j].type == tokenize.OP and s in ")]}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        if j + 1 < len(tokens) and tokens[j + 1].string == ":":
            issues.append((node.lineno, "parenthesized multi-item 'with (...)' is 3.9+"))
    return issues


# ---------------------------------------------------------------- driver

def check_source(source, filename="<string>"):
    """Returns a sorted list of (line, reason)."""
    issues = []
    try:
        compile(source, filename, "exec", dont_inherit=True)
    except SyntaxError as e:
        return [(e.lineno or 0, "does not compile: %s" % (e.msg,))]
    tree = ast.parse(source, filename)
    _Visitor(source.splitlines(), issues).visit(tree)
    issues.extend(_token_issues(source))
    issues.extend(_with_issues(tree, source))
    return sorted(set(issues))


def iter_python_files(paths):
    for path in paths:
        if os.path.isdir(path):
            for root, dirs, files in os.walk(path):
                dirs[:] = sorted(d for d in dirs if d != "__pycache__")
                for name in sorted(files):
                    if name.endswith(".py"):
                        yield os.path.join(root, name)
        else:
            yield path


def check_paths(paths):
    """Returns a list of 'file:line: reason' strings."""
    out = []
    for path in iter_python_files(paths):
        try:
            with io.open(path, "r", encoding="utf-8") as f:
                source = f.read()
        except Exception as e:
            out.append("%s:0: cannot read: %s" % (path, e))
            continue
        for line, reason in check_source(source, path):
            out.append("%s:%d: %s" % (path, line, reason))
    return out


def main(argv):
    if not argv:
        print("usage: check_py37.py PATH [PATH ...]")
        return 2
    files = list(iter_python_files(argv))
    if not files:
        print("check_py37: no .py files found")
        return 1
    problems = check_paths(argv)
    for p in problems:
        print(p)
    if problems:
        print("check_py37: %d problem(s) in %d file(s)" % (len(problems), len(files)))
        return 1
    print("check_py37: %d file(s) OK for Python 3.7" % len(files))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
