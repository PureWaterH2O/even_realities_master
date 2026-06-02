# VHS tape — render the preview harness's captured ANSI frames to PNGs.
#
# The frames are produced by:  PREVIEW=1 npx vitest run test/preview
# (writes preview-out/*.ansi). This tape cats each full-color frame in a real
# headless terminal and screenshots it, so the controller can SEE the desk's
# formatting/colour exactly as a terminal renders it — no live Hub or model.
#
# Run:  vhs scripts/screenshots.tape   (from colive-terminal/)

Set Shell "bash"
Set FontSize 14
Set Width 1280
Set Height 1120
Set Padding 12

Hide
Type "clear && cat preview-out/cockpit-03-full.ansi" Enter
Show
Sleep 600ms
Screenshot preview-out/shot-cockpit-full.png

Hide
Type "clear && cat preview-out/cockpit-04-full-verbose.ansi" Enter
Show
Sleep 600ms
Screenshot preview-out/shot-cockpit-full-verbose.png

Hide
Type "clear && cat preview-out/cockpit-01-window-default.ansi" Enter
Show
Sleep 600ms
Screenshot preview-out/shot-cockpit-window.png

Hide
Type "clear && cat preview-out/markdown-01-full.ansi" Enter
Show
Sleep 600ms
Screenshot preview-out/shot-markdown.png

Hide
Type "clear && cat preview-out/inprogress-01-full.ansi" Enter
Show
Sleep 600ms
Screenshot preview-out/shot-inprogress.png
