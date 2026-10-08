import collections, sys
tot = collections.Counter(); per = {}; cur = None
for ln in open(sys.argv[1] if len(sys.argv) > 1 else 'sizes.txt'):
    if ln.startswith('=='): cur = ln.split('/')[-1].strip(); per[cur] = collections.Counter(); continue
    p = ln.split()
    if len(p) < 3: continue
    name, size = p[1], int(p[2], 16)
    k = ('text' if name.startswith('.text') else 'rodata' if name.startswith('.rodata') else
         'data' if name.startswith(('.data', '.sdata')) else 'bss' if name.startswith(('.bss', '.sbss')) else 'other:' + name.split('.')[1] if name.count('.') else None)
    if k: per[cur][k] += size; tot[k] += size
fl = lambda c: c['text'] + c['rodata'] + c['data']
print({k: v for k, v in tot.items()}); print('flash (text+rodata+data) =', fl(tot), 'B; RAM statics (data+bss) =', tot['data'] + tot['bss'])
for f, c in sorted(per.items(), key=lambda x: -fl(x[1]))[:14]:
    print(f"{f:34s} text {c['text']:7d} rodata {c['rodata']:6d} data {c['data']:5d} bss {c['bss']:6d}")
opt = ['src_doom_p_saveg.c.o', 'src_aes_prng.c.o', 'src_sha1.c.o', 'src_doom_wi_stuff.c.o', 'src_doom_f_finale.c.o', 'src_net_client.c.o', 'src_doom_d_net.c.o', 'src_d_loop.c.o', 'src_doom_statdump.c.o', 'src_m_config.c.o', 'src_doom_am_map.c.o']
print('droppable for an MVP:', {o: fl(per[o]) for o in opt if o in per}, 'sum', sum(fl(per[o]) for o in opt if o in per))
print('music only (opl + i_oplmusic + musx):', sum(fl(c) for f, c in per.items() if f.startswith('opl_') or 'oplmusic' in f or 'musx' in f))
