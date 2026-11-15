import json, re
from glosses import G
P=json.load(open('pairs.json')); R=json.load(open('rows.before.json'))
ART=re.compile(r'^(el|la|los|las|un|una|unos|unas|der|die|das|ein|eine)\s+(?=\S)', re.I)
D_HYG={22:'inflected phrase, not a lexeme',125:'housing word in work topic',129:'dated/rare',168:'classroom desk, not home',212:'sport event, not environment/society',
       275:'job, not family',291:'compositional (kitchen table)',294:'classroom bench, off-topic',333:'compositional (technology shop)',
       395:'duplicate of performans değerlendirmesi',398:'duplicate of performans değerlendirmesi',401:'duplicate of işe alım'}
D_Q={73:'prompt defines parents generation, not Generation',191:'prompt defines climate change; answer cambio is a fragment'}
ROW_Q={'2b963af7':'esposa prompt: woman married to your father','cf6bf6d4':'esposa prompt: woman married to your father','6f15a958':'esposo prompt garbled'}
REAPPROVE={32:'Mittag',366:'kilo vermek'}
L_DEDUP={253:'sostenibilidad homed in es-b1-environment',116:'Gesundheitssystem homed in de-b1-environment',185:'colegio homed in es-a1-city-places',
         319:'homed in tr-a1-transport-places',320:'homed in tr-a1-transport-places',321:'homed in tr-a1-transport-places',323:'homed in tr-a1-transport-places',379:'merged into şikayet target'}
def tier(f): return 'extended' if f is None else ('core' if f<=1000 else 'common' if f<=2500 else 'extended')
by=lambda p:[r for r in R if r['topic']==p['topic'] and r['w']==p['w']]
decisions=[]; inserts=[]; demotes=[]; reapprove=[]
for i,p in enumerate(P):
    rows=by(p); els=p['elsewhere']
    self_rej=any(e.startswith(p['topic']+':rejected') for e in els)
    appr_else=[e for e in els if e.endswith(':approved') and not e.startswith(p['topic']+':')]
    if i in REAPPROVE: act,why='reapprove','rejected target here but approved nowhere; core word for topic'; reapprove.append((p['lang'],p['topic'],REAPPROVE[i]))
    elif i in D_Q: act,why='demote-quality',D_Q[i]
    elif i in D_HYG: act,why='demote',D_HYG[i]
    elif self_rej: act,why='demote','curator rejected this word for this topic'
    elif i in L_DEDUP: act,why='leave',L_DEDUP[i]
    elif appr_else: act,why='leave','approved in '+','.join(e.rsplit(':',1)[0] for e in appr_else)
    else:
        act,why='add',''
        g=G[i]; gloss,pos=g[0],g[1]
        raw=sorted(p['raws'],key=len)[-1]
        disp=g[2] if len(g)>2 else raw
        lemma=g[3] if len(g)>3 else (ART.sub('',raw) if p['lang']=='DE' else ART.sub('',raw).lower() if p['lang']=='ES' else raw)
        good=[r for r in rows if r['id'][:8] not in ROW_Q and r['ex']]
        ex=(good or rows)[0]['ex']
        inserts.append(dict(language=p['lang'],umbrella_key=p['topic'],cefr_level=p['cefr'],lemma=lemma,display_form=disp,gloss=gloss,
            example_sentence=ex,freq_rank=p['freq'],tier=tier(p['freq']),pos=pos))
    for r in rows:
        if act.startswith('demote'):
            demotes.append(dict(id=r['id'],reason='quality' if act=='demote-quality' else 'pool-hygiene',topic=p['topic'],word=r['raw'],why=why,prior_status=r['status'],prior_demotion_reason=r['demotion_reason']))
        elif r['id'][:8] in ROW_Q:
            demotes.append(dict(id=r['id'],reason='quality',topic=p['topic'],word=r['raw'],why=ROW_Q[r['id'][:8]],prior_status=r['status'],prior_demotion_reason=r['demotion_reason']))
    decisions.append(dict(topic=p['topic'],word=p['w'],rows=len(rows),action=act,why=why))
json.dump(dict(decisions=decisions,inserts=inserts,demotes=demotes,reapprove=reapprove),open('plan.json','w'),ensure_ascii=False,indent=1)
from collections import Counter
print(Counter(d['action'] for d in decisions)); print(Counter((d['action'],) for d in decisions for _ in range(d['rows'])))
print('inserts',len(inserts),'demote rows',len(demotes),Counter(d['reason'] for d in demotes),'reapprove',reapprove)
