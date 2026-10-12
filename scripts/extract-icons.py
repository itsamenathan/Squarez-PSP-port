#!/usr/bin/env python3
"""Extract ICON0.PNG from the original PSP PBP and make padded PWA icons.

Usage: python3 scripts/extract-icons.py /path/to/SQUAREZ.zip
Requires ffmpeg only when regenerating icons, not to run the game.
"""
import pathlib
import struct
import subprocess
import sys
import zipfile

root = pathlib.Path(__file__).resolve().parent.parent
out = root / 'assets' / 'icons'
with zipfile.ZipFile(sys.argv[1]) as archive:
    pbp = archive.read('SQUAREZ/SQUAREZ%/EBOOT.PBP')
if pbp[:4] != b'\0PBP':
    raise ValueError('Not a PSP PBP file')
offsets = struct.unpack_from('<8I', pbp, 8)
icon = pbp[offsets[1]:offsets[2]]
if not icon.startswith(b'\x89PNG\r\n\x1a\n'):
    raise ValueError('ICON0 is not a PNG image')
out.mkdir(parents=True, exist_ok=True)
source = out / 'psp-icon.png'
source.write_bytes(icon)

# The original is landscape artwork. Preserve it rather than cropping the title.
# Maskable artwork stays inside the central 80% safe-area circle.
for name, size, fraction in [
    ('icon-192.png', 192, .88),
    ('icon-512.png', 512, .88),
    ('apple-touch-icon.png', 180, .88),
    ('icon-maskable-512.png', 512, .68),
]:
    width = int(size * fraction)
    filters = (f'scale={width}:-1:flags=lanczos,'
               f'pad={size}:{size}:(ow-iw)/2:(oh-ih)/2:color=0x071629,format=rgb24')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(source),
                    '-vf', filters, '-frames:v', '1', str(out / name)], check=True)
