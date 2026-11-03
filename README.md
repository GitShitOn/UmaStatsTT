# UmaStatsTT

Analisi dei risultati di **Team Trials** di *Uma Musume Pretty Derby*: legge i file JSON
delle sessioni (`TT-AAAAMMGG_hhmmss_xxx.json`) e mostra dove fai punti, dove li perdi e cosa
conviene migliorare per alzare il punteggio.

Lo script decodifica anche il replay binario di ogni gara (`race_scenario`). Da lì ricava
eventi di punteggio, skill attivate, HP, ritardo in partenza, rushed e sprint finale di ogni uma.

## Requisiti

Python 3.8 o superiore, nessuna libreria esterna.

## Uso

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
python3 tt_stats.py data/ --nomi-skill skills.json   # mostra i nomi delle skill
```

`--nomi-skill` accetta un JSON `{"200012": "Nome skill", ...}` oppure una lista
`[{"id": 200012, "name_en": "Nome skill"}, ...]`. Senza questo file le skill sono indicate
con il loro ID, che puoi cercare su GameTora.

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
| Skill | Attivazioni e punti per skill, skill mai attivate |
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

## Limiti

- I file contengono i punteggi della tua squadra, non quelli degli avversari.
- Le regole indicate come "dedotto" si basano su pochi casi.
- Le probabilità legate alla Saggezza usano formule note della community e sono indicative:
  skill `max(100 - 9000/WIT, 20)%`, rushed `(6,5 / log10(WIT/10 + 1))^2 %`.
- Le stime di guadagno servono a ordinare le priorità, non sono previsioni esatte.
