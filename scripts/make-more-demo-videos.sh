#!/usr/bin/env bash
# Builds three more demo "walkthroughs" from free stock clips (Pexels License: free to use, no attribution
# required). Each is a montage, not one real property. Sources go in media/src2/ (names are
# <video-id>-<file name> as downloaded from https://www.pexels.com/video/<id>/).
#   studio-demo:     29459385 elegant-modern-interior-design-showcasing-cozy-spaces, 12188732 kitchenette-in-hotel-room, 5823678 house-interior-design
#   house-demo:      3770034 interior-design-of-a-small-home, 39334564 modern-backyard-patio-with-landscaped-garden, 7578543 video-of-a-backyard
#   penthouse-demo:  10843342 home-showcase-interior, 40187584 luxurious-modern-apartment-with-ocean-view
set -euo pipefail
cd "$(dirname "$0")/../media"
V='scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:black,fps=25,setsar=1,format=yuv420p'
montage() { # output, then input files
  out=$1; shift
  inputs=(); filt=""; n=0
  for f in "$@"; do inputs+=(-i "src2/$f"); filt+="[$n:v]${V}[v$n];"; n=$((n+1)); done
  for i in $(seq 0 $((n-1))); do filt+="[v$i]"; done
  filt+="concat=n=$n:v=1:a=0[v]"
  ffmpeg -y -v error "${inputs[@]}" -filter_complex "$filt" -map "[v]" -an -c:v libx264 -preset veryfast -crf 23 -movflags +faststart "$out"
  printf "%s: " "$out"; ffprobe -v error -show_entries format=duration -of csv=p=0 "$out"
}
montage studio-demo.mp4 29459385-12681247_1440_2560_60fps.mp4 12188732-12188732-uhd_2560_1440_25fps.mp4 5823678-5823678-uhd_1440_2560_24fps.mp4
montage house-demo.mp4 3770034-3770034-hd_1920_1080_25fps.mp4 39334564-16738634_2560_1440_24fps.mp4 7578543-uhd_30fps.mp4
montage penthouse-demo.mp4 10843342-10843342-uhd_2560_1440_30fps.mp4 40187584-17167696_1440_2560_30fps.mp4
