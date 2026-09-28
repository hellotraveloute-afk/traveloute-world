#!/bin/sh
# Copies ../../js into app/ as .mjs, pointing bare imports at the stubs.
cd "$(dirname "$0")"
mkdir -p app
for f in ../../js/*.js; do
  b=$(basename "$f" .js)
  sed -e "s#from 'three/addons/[^']*'#from '../stubs/three-stub.mjs'#" \
      -e "s#from 'three'#from '../stubs/three-stub.mjs'#" \
      -e "s#from 'pbf'#from '../stubs/pbf-stub.mjs'#" \
      -e "s#from '@mapbox/vector-tile'#from '../stubs/vt-stub.mjs'#" \
      -e "s#from '\./\([a-z]*\)\.js'#from './\1.mjs'#" "$f" > "app/$b.mjs"
done
