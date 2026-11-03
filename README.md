# UmaStatsTT

Analisi dei risultati di **Team Trials** di *Uma Musume Pretty Derby*: legge i file JSON
delle sessioni (`TT-AAAAMMGG_hhmmss_xxx.json`) e mostra dove fai punti, dove li perdi e cosa
conviene migliorare per alzare il punteggio.

Lo script decodifica anche il replay binario di ogni gara (`race_scenario`). Da lì ricava
eventi di punteggio, skill attivate, HP, ritardo in partenza, rushed e sprint finale di ogni uma.

Si può usare in due modi: come **webapp** nel browser, oppure come **script Python** da terminale.
I calcoli sono gli stessi.

## Webapp

La cartella `web/` contiene una webapp statica, senza server e senza installazione. Trascini
i file `TT-*.json` sulla pagina e l'analisi parte nel browser: i file non vengono inviati da
nessuna parte. La pagina li ricorda sul dispositivo finché non premi "Svuota".

- **Dal disco:** apri `web/index.html` con un doppio clic.
- **File unico da condividere o usare offline:** `python3 web/build.py` crea
  `dist/UmaStatsTT.html`, con stile, codice e nomi delle skill inclusi.
- **Online con GitHub Pages:** il workflow `.github/workflows/pages.yml` pubblica `web/` a
  ogni push sul branch predefinito che modifica la webapp. Va attivato una volta sola:
  Settings → Pages → Build and deployment → Source: **GitHub Actions**. Poi, dalla scheda
  Actions, avvia "Pubblica la webapp su GitHub Pages" con *Run workflow* (o fai un push).
  L'indirizzo sarà `https://<utente>.github.io/UmaStatsTT/`. Va bene anche qualsiasi altro
  hosting statico: basta caricare il contenuto di `web/`.

Contenuto della pagina:
- sintesi con i numeri chiave e le 5 azioni che valgono di più;
- grafico del punteggio per sessione;
- da dove arrivano i punti;
- andamento per distanza;
- punti di ogni uma divisi per fonte, con diagnostica e scheda (gare e skill);
- confronto delle statistiche con gli avversari;
- skill mai attivate;
- dettaglio gara per gara;
- priorità;
- legenda;
- esportazione CSV negli appunti.

| File | Ruolo |
|---|---|
| `web/engine.js` | Analisi: lettura dei file, decodifica del replay, statistiche, raccomandazioni. Gira anche in Node |
| `web/app.js` | Interfaccia: caricamento dei file, grafici, tabelle |
| `web/index.html`, `web/style.css` | Pagina e stile (tema chiaro e scuro) |
| `web/skill_names.js` | Nomi delle skill, generato da `tt_stats.py --aggiorna-nomi` |
| `web/demo.js` | Dati di esempio da mostrare all'apertura (vuoto nel repository) |

## Requisiti dello script

Python 3.8 o superiore, nessuna libreria esterna.

## Uso dello script

```bash
# metti i file TT-*.json in ./data (oppure passa file/cartelle come argomenti)
python3 tt_stats.py
python3 tt_stats.py data/
python3 tt_stats.py TT-20260909_180032_837.json TT-20260909_180753_776.json

# opzioni
python3 tt_stats.py data/ --dettaglio            # resoconto gara per gara
python3 tt_stats.py data/ --skill                # tabella completa delle skill di ogni uma
python3 tt_stats.py data/ --md report.md         # salva anche in Markdown
python3 tt_stats.py data/ --csv export/          # esporta i dati in CSV per Excel/Sheets
python3 tt_stats.py --aggiorna-nomi              # scarica i nomi delle skill uscite di recente
```

## Nomi delle skill

I nomi (versione Global) e la rarità delle skill (bianca, oro, unica) sono in
`skill_names.json`, accanto allo script, una skill per riga: `"200432": ["Focus", 1]`.
I dati vengono dal progetto [alpha123/uma-tools](https://github.com/alpha123/uma-tools)
(`umalator-global/skillnames.json` e `skill_data.json`), estratti dai testi del client Global.

- Quando escono skill nuove, `python3 tt_stats.py --aggiorna-nomi` scarica di nuovo il file
  e aggiorna anche `web/skill_names.js` per la webapp. Nella webapp puoi anche trascinare
  un JSON di nomi insieme ai file delle sessioni.
  Le skill senza nome compaiono con il loro ID e il report lo segnala.
- `--nomi-skill FILE.json` aggiunge o sostituisce dei nomi, ad esempio per tradurli. Accetta
  `{"200012": "Nome"}`, `{"200012": ["Nome", 1]}` oppure `[{"id": 200012, "name_en": "Nome"}]`.

## Cosa contiene il report

| Sezione | A cosa serve |
|---|---|
| In sintesi | Le 5 azioni che valgono di più, in punti finali stimati per sessione, più le attitudini sotto A |
| Sessioni | Punteggio, vittorie e sconfitte, valutazione dell'avversario e moltiplicatori di ogni sessione |
| Come si forma il punteggio | Bonus percentuali osservati e quanto vale 1 punto base |
| Da dove arrivano i punti | Peso di ogni categoria (piazzamento, skill, partenza, ...) sul totale |
| Per distanza | Punti, vittorie, piazzamento medio e bonus squadra per Sprint, Mile, Medium, Long e Dirt |
| Rendimento per uma | Arrivi, punti base e finali per gara, divisi per fonte |
| Diagnostica per uma | Skill per gara, unica attivata, partenze perfette, "1a del proprio stile", rushed, HP finita, sprint in ritardo, HP residua, tempo bloccata |
| Statistiche e attitudini | Statistiche, attitudini, probabilità teoriche di attivazione skill e di rushed (da WIT), umore |
| Noi contro gli avversari | Statistiche medie a confronto per distanza e chi ha vinto le gare perse |
| Fattori casuali | Effetto dell'umore e frequenza delle partenze perfette |
| Skill | Attivazioni e punti per skill (con nome e tipo), skill mai attivate |
| Cosa migliorare | Elenco completo delle priorità, con stima del guadagno |

## Come si calcola il punteggio (ricavato dai dati)

Ogni evento dà **punti base**. Ogni voce viene poi moltiplicata per `1 + bonus`, e alla fine
si aggiunge il bonus squadra. Lo script verifica che la somma coincida con `team_total_score`.

| Evento | Punti base |
|---|---|
| Piazzamento | 1a 10.000, 2a 8.000, 3a 7.000, 4a 6.000, 5a 5.000, 6a-7a 4.000, 8a 3.000, 10a-12a 2.000 |
| Margine di vittoria (solo la 1a) | più distacco = più punti (osservati 1.000-2.200) |
| Skill bianca / unica ereditata | 500 per attivazione (contano anche le passive) |
| Skill oro | 1.200 per attivazione |
| Skill unica | 2.300-2.500 (sale con il livello) |
| Partenza perfetta | 1.000 se il ritardo al via è sotto 0,02 s |
| 1a del proprio stile a 1/6 di gara | 1.000 se sei davanti a tutte le uma con la tua stessa strategia |
| 1a del proprio stile a 2/3 di gara | 1.000, stessa regola all'inizio della fase finale |
| Bonus tempo | +100 ogni 0,1 s sotto un tempo di riferimento del percorso |
| Rushed (kakari) | -500 all'inizio, -100 per ogni secondo |
| Sorpresa (dedotto) | 3.000-4.000 per un 1°/2° posto partendo poco favorita |
| Squadra | +4.000 se tutte e 3 sono nelle prime 5, +5.000 se tutte nelle prime 3 |

| Bonus percentuale | Valore osservato |
|---|---|
| Avversario | circa +155%, cresce con la valutazione della squadra avversaria |
| Carte supporto | `support_card_bonus` / 100 (es. 1018 = +10,18%) |
| Prima uma della distanza (slot 1) | +10% |
| Serie di vittorie | +2% alla 2a vittoria di fila, +3% alla 3a, ... |

In pratica 1 punto base vale circa 2,65 punti finali. Per salire contano i punti base.

## Se cambi la squadra tra una sessione e l'altra

Ogni uma allenata viene riconosciuta dal suo `trained_chara_id`. In questo modo le
statistiche di uma diverse non si mescolano mai, anche se sono lo stesso personaggio.

- La **squadra attuale** è quella dell'ultima sessione: l'ordine è dato dalla data nel nome
  del file `TT-AAAAMMGG_hhmmss`. I consigli riguardano solo la squadra attuale.
- Le uma uscite restano nelle statistiche, segnate **(ex)** nello script ed «ex» nella
  webapp, e non generano consigli.
- Se ri-alleni lo stesso personaggio, le versioni diventano `v1`, `v2`, ... in ordine di
  apparizione.
- Una sezione elenca i cambi tra una sessione e l'altra: uma entrate, uscite e spostate di
  distanza o di slot.
- Per le uma con meno di 3 gare il report lo segnala, e la skill unica non viene giudicata
  dopo una sola gara.

## Limiti

- I file contengono i punteggi della tua squadra, non quelli degli avversari.
- Le regole indicate come "dedotto" si basano su pochi casi.
- Le probabilità legate alla Saggezza usano formule note della community e sono indicative:
  skill `max(100 - 9000/WIT, 20)%`, rushed `(6,5 / log10(WIT/10 + 1))^2 %`.
- Le stime di guadagno servono a ordinare le priorità, non sono previsioni esatte.
