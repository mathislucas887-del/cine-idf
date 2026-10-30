#!/bin/bash
# À lancer après « gh auth login » : crée le dépôt public cine-idf et pousse le code.
set -e; cd /workspace/cine-idf
gh repo create cine-idf --public --source . --remote origin --push
echo "Dépôt : $(gh repo view --json url -q .url)"
echo "Render : https://dashboard.render.com/blueprint/new?repo=$(gh repo view --json url -q .url)"
