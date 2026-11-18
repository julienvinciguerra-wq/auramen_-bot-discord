# Archivio impostazioni AURAMEN

Questo archivio contiene esclusivamente impostazioni verificate e autorizzate da AURAMEN.

## Dove aggiungere i dati

- Dati: `knowledge/settings.json`
- Screenshot: `knowledge/images/<gioco-o-programma>/`

Esempio di struttura per un futuro inserimento (i valori sono segnaposto, non impostazioni reali):

```json
{
  "id": "fortnite-video",
  "game": "Fortnite",
  "title": "Impostazioni video",
  "aliases": ["grafica fortnite", "video fortnite", "qualità grafica"],
  "keywords": ["risoluzione", "fps", "modalità rendering"],
  "sections": [
    {
      "name": "Video",
      "items": [
        { "name": "Risoluzione", "value": "INSERIRE VALORE VERIFICATO" }
      ]
    }
  ],
  "images": ["fortnite/schermata-video.png"],
  "notes": ""
}
```

Ogni oggetto va inserito nell'array `entries` di `settings.json`. Le immagini vanno indicate con un percorso relativo a `knowledge/images/`. Non inserire token, password, dati personali o impostazioni non confermate.

L'assistente risponde solo nei ticket aperti registrati nel database. Se l'archivio è vuoto o la corrispondenza è incerta, non inventa valori.
