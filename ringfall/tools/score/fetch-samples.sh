#!/bin/sh
# Fetch only the instruments the score uses from the two CC0 Versilian libraries (sparse, blob-filtered clones).
set -e
cd "$(dirname "$0")"
mkdir -p samples && cd samples
[ -d VSCO-2-CE ] || git clone -q --filter=blob:none --no-checkout https://github.com/sgossner/VSCO-2-CE.git
[ -d VCSL ] || git clone -q --filter=blob:none --no-checkout https://github.com/sgossner/VCSL.git
cd VSCO-2-CE
git sparse-checkout init --no-cone
git sparse-checkout set --no-cone \
  '/Strings/Violin Section/susVib/' '/Strings/Violin Section/Spic/' '/Strings/Violin Section/Trem/' \
  '/Strings/Viola Section/susvib/' '/Strings/Viola Section/spic/' '/Strings/Viola Section/trem/' \
  '/Strings/Cello Section/susvib/' '/Strings/Cello Section/spic/' '/Strings/Cello Section/trem/' '/Strings/Cello Section/pizzT/' \
  '/Strings/Solo Contrabass/SusVib/' '/Strings/Solo Contrabass/Spic/' '/Strings/Solo Contrabass/Pizz/' '/Strings/Solo Violin/Arco Vib/' \
  '/Brass/F Horn/sus/' '/Brass/F Horn/stac/' '/Brass/Trumpet/sus/' '/Brass/Tenor Trombone/sus/' '/Brass/Tenor Trombone/stac/' \
  '/Brass/Tuba/sus/' '/Brass/Tuba/stac/' '/Woodwinds/Flute/susvib/' '/Woodwinds/Oboe/Vib/' '/Woodwinds/Clarinet/susLong/' '/Woodwinds/Bassoon/sus/' \
  '/Percussion/Timpani/' '/Percussion/BDrumNewhit*' '/Percussion/gongHit*' '/Percussion/susCymb1*' '/Percussion/cymbal*' '/LICENSE' '/README.md'
git checkout -q HEAD
cd ../VCSL
git sparse-checkout init --no-cone
git sparse-checkout set --no-cone \
  '/Chordophones/Zithers/Grand Piano, Steinway B/' '/Chordophones/Composite Chordophones/Concert Harp/' \
  '/Membranophones/Struck Membranophones/Bass Drum 2/' '/Membranophones/Struck Membranophones/Frame Drum/' \
  '/Membranophones/Struck Membranophones/Timpani 2/' '/Idiophones/Struck Idiophones/Suspended Cymbal 1/' \
  '/Idiophones/Struck Idiophones/Gong 1/' '/Aerophones/Edge-blown Aerophones/Pipe Organ/' '/README.md'
git checkout -q HEAD
echo "samples ready in $(pwd)/.."
