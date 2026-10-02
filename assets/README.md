# Brand icons

The three Icon Composer projects are the source of truth for full application icons:

- `dev/app-icon.icon`
- `nightly/app-icon.icon`
- `prod/app-icon.icon`

Each project uses `text.svg` for the filled Lucide Plane mark and `background.svg` when the background is a vector layer. Additional layers use semantic names that describe their role and placement.

Run `vp run icons:export` from the repository root to regenerate the tracked iOS, Linux, Windows, and web assets. The development web exports are also copied to `apps/web/public` for the browser favicon and splash screen. Production favicons and production/nightly WebP icons are exported to the marketing app. Run `vp run icons:check` to verify that the generated assets and public copies match their sources without changing files.

Exporting requires Icon Composer 2 or newer on macOS. The script selects the newest compatible exporter from Xcode or a standalone Icon Composer installation and pins design generation 26. Set `ICON_COMPOSER_TOOL` to the full path of `Icon Composer.app/Contents/Executables/ictool` to override automatic discovery.

## macOS exports

Packaged macOS apps compile the Icon Composer `.icon` source natively. The tracked macOS PNGs supply the development launcher's ICNS and runtime Dock image, plus a packaged fallback resource. Those raster assets need the macOS safe area even on Tahoe and Golden Gate; a full-bleed `iOS, macOS` PNG renders too large in the Dock.

The automated export script leaves the macOS PNGs unchanged. Use Xcode's native compiler to generate an ICNS with all renditions, then extract its 1024px PNG unchanged. For Nightly:

```sh
icon_output=$(mktemp -d /tmp/pilot-icon.XXXXXX)
xcrun actool assets/nightly/app-icon.icon \
  --compile "$icon_output" \
  --output-format human-readable-text \
  --output-partial-info-plist "$icon_output/info.plist" \
  --app-icon app-icon --target-device mac \
  --minimum-deployment-target 26.0 --platform macosx \
  --standalone-icon-behavior all
iconutil -c iconset "$icon_output/app-icon.icns" -o "$icon_output/app.iconset"
cp "$icon_output/app.iconset/icon_512x512@2x.png" assets/nightly/nightly-macos-1024.png
```

Repeat for these source/destination pairs:

- `assets/dev/app-icon.icon` -> `assets/dev/blueprint-macos-1024.png`
- `assets/nightly/app-icon.icon` -> `assets/nightly/nightly-macos-1024.png`
- `assets/prod/app-icon.icon` -> `assets/prod/black-macos-1024.png`

`--standalone-icon-behavior all` is required: the default compiler output can omit the 1024px rendition. No resizing or compositing is needed; the compiler supplies the native mask, glass rendering, margins, and shadow.

Verify with `vp test run scripts/lib/macos-icon-assets.test.ts`. Each PNG must be 1024×1024 with an 824×824 opaque body inset 100px on every side, and native shadow outside it. Icon Composer's GUI `macOS pre-Tahoe` preset may also be used, but verify its output: some versions still export full-bleed PNGs. A preset label alone is not proof of correct Dock sizing.

Do not edit the generated PNG or ICO files directly.

## Android launcher and splash artwork

Android masks the central 72dp of a 108dp adaptive canvas, and the Android 12+ splash screen masks
the central two thirds of a 288dp canvas, so the Icon Composer exports cannot be used directly:
their rounded-square silhouette gets framed again and the mark is cropped. The Android artwork
is instead rendered from the same Icon Composer SVG sources by `vp run icons:export:android`:

- `apps/mobile/assets/android-icon-foreground.png`: the shared transparent mark, sized to stay
  inside the safe zone
- `apps/mobile/assets/android-icon-background-dev.png` and `-nightly.png`: full-bleed variant
  artwork (blueprint grid and annotations; night sky and clouds). Production uses a solid color.
- `apps/mobile/assets/android-splash-icon-*.png`: the two layers composed into one 288dp image, so
  the splash mask reproduces the launcher icon's framing.

Rerun the export after changing a layer SVG. The exporter also updates `android-icon-mark.png` and `android-notification-icon.png` as flat silhouettes for notifications and
Android's monochrome themed icon.

The plane silhouette comes from Lucide (ISC license); see `lucide-LICENSE`.
