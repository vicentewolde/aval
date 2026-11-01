#!/usr/bin/env bash
# Builds media/demo-walkthrough.mp4: a ~58 s vertical "walkthrough" montage from four free stock clips
# (Pexels License, https://www.pexels.com/license/ — free to use, no attribution required). It is NOT
# one real property: it exists so the pipeline can be shown on rights-clear footage.
# Sources (put them in media/src/):
#   14959266_1440_2562_60fps.mp4   https://www.pexels.com/video/modern-minimalist-apartment-interior-tour-35308496/  (Wilfred Panakkal)
#   14507342_1440_2560_24fps.mp4   https://www.pexels.com/video/modern-dining-and-kitchen-area-with-dark-decor-34231477/
#   10135236-uhd_2560_1440_25fps.mp4  https://www.pexels.com/video/modern-minimalist-bedroom-interior-10135236/
#   14807054_2560_1440_25fps.mp4   https://www.pexels.com/video/modern-bathroom-interior-with-rolltop-bath-34955000/
set -euo pipefail
cd "$(dirname "$0")/../media"
V='scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:black,fps=25,setsar=1,format=yuv420p'
ffmpeg -y -v error \
  -i src/14959266_1440_2562_60fps.mp4 -i src/14507342_1440_2560_24fps.mp4 \
  -i src/10135236-uhd_2560_1440_25fps.mp4 -i src/14807054_2560_1440_25fps.mp4 \
  -filter_complex "[0:v]${V}[a];[1:v]${V}[b];[2:v]${V}[c];[3:v]${V}[d];[a][b][c][d]concat=n=4:v=1:a=0[v]" \
  -map "[v]" -an -c:v libx264 -preset veryfast -crf 23 -movflags +faststart demo-walkthrough.mp4
echo "segments (s): living/dining 0-23.6 | kitchen 23.6-30.5 | bedroom 30.5-41.3 | bathroom 41.3-59.2"
