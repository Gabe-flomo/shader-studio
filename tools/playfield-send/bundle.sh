#!/usr/bin/env bash
# Build "Playfield Send.vst3" (docs/playfield-send-plan.md, section 6).
#
#   bash tools/playfield-send/bundle.sh            # → tools/playfield-send/bundle/Playfield Send.vst3
#
# - Builds the plugin for arm64 and, when its Rust target is installed (rustup target add
#   x86_64-apple-darwin), for x86_64 too, and joins them with lipo (universal). PFSEND_UNIVERSAL=1
#   makes a missing x86_64 target an error instead of a note.
# - Lays out Contents/{Info.plist, PkgInfo, MacOS/Playfield Send, Resources/CREDITS.txt}.
# - Signs it: ad hoc (`codesign -s -`) unless PFSEND_SIGN_IDENTITY names a Developer ID, in which
#   case it signs with the hardened runtime and a timestamp (for notarisation inside the app).
# The desktop app ships this bundle as a resource (src-tauri/tauri.conf.json) and copies it to
# ~/Library/Audio/Plug-Ins/VST3/ from Settings (src-tauri/src/live_send.rs).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
out_dir="$here/bundle"
bundle="$out_dir/Playfield Send.vst3"
version="$(sed -n 's/^pub const PLUGIN_VERSION: &str = "\(.*\)";/\1/p' "$repo/crates/pfsend-protocol/src/lib.rs")"
[ -n "$version" ] || { echo "bundle.sh: couldn't read PLUGIN_VERSION" >&2; exit 1; }

export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-11.0}"
targets=(aarch64-apple-darwin)
if rustup target list --installed 2>/dev/null | grep -qx 'x86_64-apple-darwin'; then
  targets+=(x86_64-apple-darwin)
elif [ "${PFSEND_UNIVERSAL:-0}" = "1" ]; then
  echo "bundle.sh: x86_64-apple-darwin isn't installed (rustup target add x86_64-apple-darwin)" >&2
  exit 1
else
  echo "bundle.sh: note: x86_64-apple-darwin isn't installed, so this build is arm64 only (Apple Silicon)."
  echo "           For a universal build: rustup target add x86_64-apple-darwin"
fi

libs=()
for t in "${targets[@]}"; do
  echo "bundle.sh: building for $t"
  nice -n 15 cargo build --release --manifest-path "$here/Cargo.toml" --target "$t" --lib
  libs+=("$here/target/$t/release/libplayfield_send.dylib")
done

rm -rf "$bundle"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources"
if [ "${#libs[@]}" -gt 1 ]; then
  lipo -create "${libs[@]}" -output "$bundle/Contents/MacOS/Playfield Send"
else
  cp "${libs[0]}" "$bundle/Contents/MacOS/Playfield Send"
fi
sed "s/@VERSION@/$version/g" "$here/resources/Info.plist" > "$bundle/Contents/Info.plist"
printf 'BNDL????' > "$bundle/Contents/PkgInfo"
cp "$here/resources/CREDITS.txt" "$bundle/Contents/Resources/CREDITS.txt"

identity="${PFSEND_SIGN_IDENTITY:--}"
if [ "$identity" = "-" ]; then
  codesign --force --sign - "$bundle"
else
  codesign --force --options runtime --timestamp --sign "$identity" "$bundle"
fi
codesign --verify --strict --verbose=1 "$bundle"

echo "bundle.sh: $bundle"
echo "bundle.sh: version $version, $(lipo -archs "$bundle/Contents/MacOS/Playfield Send"), signed ${identity/-/ad hoc}"
