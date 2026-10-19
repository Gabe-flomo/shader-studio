import os
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

import check_py37  # noqa: E402

BAD = {
    "walrus": "if (n := 3) > 2:\n    pass\n",
    "posonly": "def f(a, /, b):\n    return a\n",
    "fstring_debug": "x = 1\ny = f'{x=}'\n",
    "fstring_debug_spec": "x = 1.5\ny = f'{x = :.2f}'\n",
    "fstring_debug_conv": "x = 1\ny = f\"{x=!s}\"\n",
    "match": "match x:\n    case 1:\n        pass\n",
    "except_star": "try:\n    pass\nexcept* ValueError:\n    pass\n",
    "paren_with": "with (open('a') as a, open('b') as b):\n    pass\n",
    "union_annotation": "def f(a: int | None):\n    return a\n",
    "union_return": "def f() -> int | None:\n    return None\n",
    "builtin_generic_annotation": "def f(a: list[int]):\n    return a\n",
    "builtin_generic_runtime": "Alias = dict[str, int]\n",
    "dict_union": "a = {'x': 1} | {'y': 2}\n",
    "dict_union_aug": "a = {}\na |= {'y': 2}\n",
    "math_prod": "import math\nmath.prod([1, 2])\n",
    "math_isqrt": "from math import isqrt\n",
    "math_dist_alias": "import math as m\nm.dist((0, 0), (1, 1))\n",
    "math_comb": "import math\nmath.comb(4, 2)\n",
    "math_perm": "import math\nmath.perm(4, 2)\n",
    "cached_property": "import functools\nclass A:\n    @functools.cached_property\n    def x(self):\n        return 1\n",
    "functools_cache": "from functools import cache\n",
    "importlib_metadata": "import importlib.metadata\n",
    "importlib_metadata_from": "from importlib import metadata\n",
    "typing_literal": "from typing import Literal\n",
    "typing_final": "import typing\nX = typing.Final\n",
    "typing_protocol": "from typing import Protocol\n",
    "typing_typeddict": "from typing import TypedDict\n",
    "typing_annotated": "from typing import Annotated\n",
    "typing_paramspec": "from typing import ParamSpec\n",
    "removeprefix": "'abc'.removeprefix('a')\n",
    "removesuffix": "s = 'abc'\ns.removesuffix('c')\n",
    "zip_strict": "list(zip([1], [2], strict=True))\n",
    "graphlib": "import graphlib\n",
    "zoneinfo": "from zoneinfo import ZoneInfo\n",
    "to_thread": "import asyncio\nasyncio.to_thread(print)\n",
    "shlex_join": "import shlex\nshlex.join(['a'])\n",
    "fmean": "from statistics import fmean\n",
    "pairwise": "import itertools\nitertools.pairwise([1, 2])\n",
    "return_star": "def f(a):\n    return 1, *a\n",
    "decorator_expr": "buttons = [lambda f: f]\n@buttons[0]\ndef g():\n    pass\n",
    "syntax_error": "def f(:\n",
}

GOOD = [
    "x = 1\ny = f'{x}'\nz = f'{x == 1}'\nw = f'{x!r:>4}'\nv = f'{x:=^10}'\n",
    "with open('a') as a, open('b') as b:\n    pass\n",
    "with (open('a')) as a:\n    pass\n",
    "def f(a, *args, b=1, **kw):\n    return (1, *args)\n",
    "a = 1 | 2\nb = {1} | {2}\n",
    "from typing import List, Dict\nx = 'abc'.startswith('a')\n",
    "import math\nmath.floor(1.5)\n",
]


class CheckerTests(unittest.TestCase):
    def test_playfield_package_passes(self):
        problems = check_py37.check_paths([os.path.join(ROOT, "Playfield")])
        self.assertEqual(problems, [])

    def test_bad_snippets_are_caught(self):
        for name, source in sorted(BAD.items()):
            issues = check_py37.check_source(source, name + ".py")
            self.assertTrue(issues, "not caught: %s" % name)

    def test_good_snippets_pass(self):
        for source in GOOD:
            self.assertEqual(check_py37.check_source(source, "good.py"), [], source)

    def test_command_line_exit_codes(self):
        script = os.path.join(ROOT, "check_py37.py")
        ok = subprocess.run([sys.executable, script, os.path.join(ROOT, "Playfield")],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertEqual(ok.returncode, 0, ok.stdout + ok.stderr)
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "bad.py")
            with open(path, "w") as f:
                f.write(BAD["walrus"])
            bad = subprocess.run([sys.executable, script, tmp],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            self.assertEqual(bad.returncode, 1)
            self.assertIn(b"bad.py:1:", bad.stdout)


if __name__ == "__main__":
    unittest.main()
