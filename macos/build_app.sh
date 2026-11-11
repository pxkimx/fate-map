#!/bin/bash
# Builds "Fate Map.app": code and catalogue are copied INTO the bundle (macOS blocks apps from reading
# scripts in ~/Documents without a privacy grant). Rebuild after changing anything.
#   macos/build_app.sh [destination-folder]      (default: this tool's folder)
set -eu
HERE="$(cd "$(dirname "$0")/.." && pwd)"; DEST="${1:-$HERE}"; APP="$DEST/Fate Map.app"
VERSION="$(sed -n 's/^__version__ = "\(.*\)"/\1/p' "$HERE/fatemap/__init__.py")"
rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/app"
cp "$HERE/launch.sh" "$HERE/LICENSE" "$APP/Contents/Resources/app/"
rsync -a --exclude '__pycache__' --exclude '*.pyc' --exclude 'dev.html' "$HERE/fatemap" "$APP/Contents/Resources/app/"
cat > "$APP/Contents/MacOS/FateMap" <<'S'
#!/bin/bash
export MODE=gui
exec /bin/bash "$(cd "$(dirname "$0")/../Resources/app" && pwd)/launch.sh"
S
chmod +x "$APP/Contents/MacOS/FateMap"
cat > "$APP/Contents/Info.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Fate Map</string>
  <key>CFBundleDisplayName</key><string>Fate Map</string>
  <key>CFBundleIdentifier</key><string>io.github.pxkimx.fate-map</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>FateMap</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>Copyright (c) 2026 Paul H. Kim. MIT licence.</string>
</dict></plist>
PL
PY="$(command -v python3)"; for c in "$HOME/Library/Application Support/CRISPR HTS Validator/venv/bin/python" /opt/anaconda3/bin/python3; do [ -x "$c" ] && "$c" -c 'import PIL' 2>/dev/null && PY="$c" && break; done
"$PY" "$HERE/macos/make_icon.py" "$APP/Contents/Resources/AppIcon.icns"
touch "$APP"; echo "Built: $APP ($VERSION, $(du -sh "$APP" | cut -f1))"
