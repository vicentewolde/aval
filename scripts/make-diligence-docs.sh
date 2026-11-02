#!/usr/bin/env bash
# Generates INVENTED Chilean-style property certificates as PDFs with a text layer (Chrome headless), in three sets:
#   ok/         consistent with the seller and the listing, nothing to flag
#   attention/  a mortgage and small debts (warnings, normal in real life)
#   blocked/    the owner is NOT the seller, plus a court prohibition (blockers)
# Every page carries "DOCUMENTO DE EJEMPLO - SIN VALOR LEGAL". Names, RUTs and numbers are fictional.
set -euo pipefail
cd "$(dirname "$0")/../fixtures/documents"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
tmp=$(mktemp -d)

doc() { # set, file, title, issuer, body html
  mkdir -p "$1"
  cat > "$tmp/$2.html" <<HTML
<!doctype html><html lang="es"><meta charset="utf-8"><style>
body{font:13px/1.55 Georgia,serif;margin:36px 48px;color:#111}h1{font-size:19px;margin:0 0 4px}h2{font-size:14px;margin:18px 0 4px}
.mark{border:2px solid #b00;color:#b00;padding:6px 10px;font:bold 12px sans-serif;display:inline-block;margin-bottom:14px}
.small{color:#444;font-size:11px}table{border-collapse:collapse}td{padding:2px 14px 2px 0;vertical-align:top}</style><body>
<div class="mark">DOCUMENTO DE EJEMPLO - SIN VALOR LEGAL</div>
<div class="small">$4</div><h1>$3</h1>$5
<p class="small">Documento generado con datos ficticios para una demostración tecnica. No es un certificado real.</p></body></html>
HTML
  "$CHROME" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="$1/$2.pdf" "file://$tmp/$2.html" >/dev/null 2>&1
}

OWNER_OK="Marta Elena Fuentes Rojas"; RUT_OK="7.654.321-K"
INMUEBLE="Departamento N&deg; 1204 del piso 12, ubicado en Avenida Irarrazaval N&deg; 3550, comuna de Nunoa, Santiago, inscrito a nombre del propietario individualizado"

mk_set() { # set, owner, rut, hipotecas html, deuda contribuciones, deuda gastos comunes, fecha
  s=$1
  doc "$s" 01-dominio "CERTIFICADO DE DOMINIO VIGENTE" "Conservador de Bienes Raices de Santiago" "
<p>El Conservador de Bienes Raices certifica que, a la fecha de emision de este documento, el inmueble que se individualiza a continuacion se encuentra vigente a nombre de:</p>
<table><tr><td>Propietario:</td><td><b>$2</b></td></tr><tr><td>RUT:</td><td>$3</td></tr>
<tr><td>Inmueble:</td><td>$INMUEBLE</td></tr><tr><td>Rol de avaluo:</td><td>1234-56</td></tr>
<tr><td>Inscripcion:</td><td>Fojas 45.678 numero 23.456 del Registro de Propiedad del ano 2015</td></tr></table>
<p>Fecha de emision: $7</p>"
  doc "$s" 02-gravamenes "CERTIFICADO DE HIPOTECAS Y GRAVAMENES" "Conservador de Bienes Raices de Santiago" "
<p>Rol de avaluo: 1234-56. Inmueble: Avenida Irarrazaval N&deg; 3550, departamento 1204, Nunoa.</p>
<h2>Gravamenes vigentes</h2>$4
<p>Fecha de emision: $7</p>"
  doc "$s" 03-contribuciones "CERTIFICADO DE DEUDA DE CONTRIBUCIONES" "Tesoreria General de la Republica" "
<p>Rol de avaluo: 1234-56. Comuna: Nunoa.</p><p>$5</p><p>Fecha de emision: $7</p>"
  doc "$s" 04-gastos-comunes "CERTIFICADO DE GASTOS COMUNES" "Administracion del Edificio" "
<p>Unidad: departamento 1204. Edificio ubicado en Avenida Irarrazaval N&deg; 3550, Nunoa.</p><p>$6</p><p>Fecha de emision: $7</p>"
}

mk_set ok "$OWNER_OK" "$RUT_OK" "<p>El inmueble <b>no registra hipotecas, prohibiciones, embargos ni otros gravamenes vigentes</b>.</p>" "El inmueble <b>no registra deuda</b> de contribuciones." "La unidad <b>no registra deuda</b> de gastos comunes al dia de hoy." "28 de octubre de 2026"
mk_set attention "$OWNER_OK" "$RUT_OK" "<p>Hipoteca a favor de Banco Ejemplo S.A., inscrita a fojas 12.345 numero 9.876 del ano 2019, por la suma de UF 2.500.</p>" "El inmueble registra deuda de contribuciones por la suma de \$ 148.320 correspondiente a la cuota de abril." "La unidad registra deuda de gastos comunes por la suma de \$ 86.500." "20 de octubre de 2026"
mk_set blocked "Ricardo Andres Mella Soto" "9.876.543-2" "<p>Prohibicion de enajenar decretada por el 12&deg; Juzgado Civil de Santiago, causa Rol C-4567-2025, inscrita a fojas 33.210 numero 15.002 del ano 2025.</p><p>Hipoteca a favor de Banco Ejemplo S.A., inscrita a fojas 12.345 numero 9.876 del ano 2019.</p>" "El inmueble <b>no registra deuda</b> de contribuciones." "La unidad <b>no registra deuda</b> de gastos comunes al dia de hoy." "5 de agosto de 2026"
rm -rf "$tmp"
ls -R . | head -20
