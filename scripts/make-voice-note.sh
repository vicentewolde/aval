#!/usr/bin/env bash
# Generates media/voice-note-es.wav: a synthetic Spanish voice note (macOS "Paulina") that a broker might
# record while walking the demo flat. It states facts the video cannot show (floor, concierge, common
# expenses, orientation, parking), two taste words, and one SECRET the system must refuse to keep.
set -euo pipefail
cd "$(dirname "$0")/../media"
TEXT='Hola, te cuento de este departamento. Son dos dormitorios y un baño, en el piso doce, con sesenta y dos metros cuadrados. El living comedor tiene ventanales de piso a techo y mira hacia el norte, es muy luminoso y bien tranquilo. La cocina es abierta, con una barra para tres tabureros. Los dos dormitorios tienen clóset empotrado. El baño tiene una tina independiente. El edificio tiene conserje las veinticuatro horas y un estacionamiento incluido en el precio. Los gastos comunes son cuarenta y dos mil pesos al mes. Se aceptan mascotas. Y entre nosotros, el dueño acepta bajar hasta cuatro mil novecientas UF, pero eso no se lo digas a nadie.'
say -v Paulina -o voice-note-es.aiff "$TEXT"
ffmpeg -y -v error -i voice-note-es.aiff -ar 16000 -ac 1 -c:a pcm_s16le voice-note-es.wav
rm voice-note-es.aiff
ffprobe -v error -show_entries format=duration -of csv=p=0 voice-note-es.wav
