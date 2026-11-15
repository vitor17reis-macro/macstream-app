#!/bin/bash
# Duplo clique para abrir o MacStream (instala o que faltar na primeira vez)
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
npm start
