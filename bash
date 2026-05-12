# Vérifier qu'aucun secret ne traîne
grep -r "sk_live\|sk_test\|LINKEDIN_SECRET" . --include="*.js" --include="*.py" --include="*.env"
