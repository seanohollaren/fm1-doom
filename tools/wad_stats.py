import struct, sys, collections
d = open(sys.argv[1], 'rb').read()
n, diro = struct.unpack('<ii', d[4:12])
L = []
for i in range(n):
    o, s, nm = struct.unpack('<ii8s', d[diro+16*i:diro+16*i+16])
    L.append((nm.rstrip(b'\0').decode().upper(), o, s))
idx = {nm: i for i, (nm, o, s) in enumerate(L)}
def lump(nm): _, o, s = L[idx[nm]]; return d[o:o+s]
def rng(a, b): return L[idx[a]+1:idx[b]]
cat = collections.Counter(); cnt = collections.Counter()
sprites = rng('S_START', 'S_END'); flats = rng('F_START', 'F_END'); patches = rng('P_START', 'P_END')
sset = {x[0] for x in sprites}; fset = {x[0] for x in flats}; pset = {x[0] for x in patches}
maps = [i for i, x in enumerate(L) if len(x[0]) == 4 and x[0][0] == 'E' and x[0][2] == 'M']
mapl = set()
for m in maps:
    for j in range(m, m+11): mapl.add(j)
for i, (nm, o, s) in enumerate(L):
    if i in mapl: c = 'maps'
    elif nm in sset: c = 'sprites'
    elif nm in fset: c = 'flats'
    elif nm in pset: c = 'wall patches'
    elif nm.startswith('DS'): c = 'sfx (DS)'
    elif nm.startswith('DP'): c = 'pc speaker sfx'
    elif nm.startswith('D_'): c = 'music'
    elif nm.startswith('GENMIDI') or nm.startswith('DMXGUS'): c = 'music instr'
    elif nm.startswith('DEMO'): c = 'demos'
    else: c = 'ui/misc gfx+tables'
    cat[c] += s; cnt[c] += 1
print('WHOLE WAD', len(d))
for c, s in cat.most_common(): print(f'  {c:22s} {cnt[c]:5d} lumps {s:9d} B')
# E1M1
m = idx['E1M1']; ml = {L[j][0]: L[j] for j in range(m+1, m+11)}
msz = sum(x[2] for x in ml.values())
print('E1M1 map lumps', msz, {k: v[2] for k, v in ml.items()})
def g(nm): _, o, s = ml[nm]; return d[o:o+s]
sd = g('SIDEDEFS'); tex = set()
for i in range(0, len(sd), 30):
    for k in (4, 12, 20):
        t = sd[i+k:i+k+8].rstrip(b'\0').decode().upper()
        if t != '-': tex.add(t)
sec = g('SECTORS'); fl = set()
for i in range(0, len(sec), 26):
    for k in (4, 12): fl.add(sec[i+k:i+k+8].rstrip(b'\0').decode().upper())
th = g('THINGS'); types = collections.Counter(struct.unpack('<h', th[i+6:i+8])[0] for i in range(0, len(th), 10))
pn = lump('PNAMES'); np_ = struct.unpack('<i', pn[:4])[0]
pnames = [pn[4+8*i:12+8*i].rstrip(b'\0').decode().upper() for i in range(np_)]
t1 = lump('TEXTURE1'); nt = struct.unpack('<i', t1[:4])[0]
texdef = {}
for i in range(nt):
    o = struct.unpack('<i', t1[4+4*i:8+4*i])[0]
    nm = t1[o:o+8].rstrip(b'\0').decode().upper()
    w, h = struct.unpack('<hh', t1[o+12:o+16]); pc = struct.unpack('<h', t1[o+20:o+22])[0]
    texdef[nm] = (w, h, [pnames[struct.unpack('<h', t1[o+22+10*j+4:o+22+10*j+6])[0]] for j in range(pc)])
# animated/switch textures: include whole families roughly by adding switch pairs
extra = set()
for t in tex:
    if t.startswith('SW1'): extra.add('SW2'+t[3:])
    if t.startswith('SW2'): extra.add('SW1'+t[3:])
tex |= {t for t in extra if t in texdef}
up = set()
for t in tex: up |= set(texdef[t][2])
psz = sum(L[idx[p]][2] for p in up if p in idx)
print(f'E1M1 textures {len(tex)} of {nt}; patches {len(up)} of {len(pset)}; patch bytes {psz}; composite px {sum(texdef[t][0]*texdef[t][1] for t in tex)}')
fsz = sum(L[idx[f]][2] for f in fl if f in idx)
print(f'E1M1 flats {len(fl)} of {len(fset)}; bytes {fsz} (+anim frames)')
print('E1M1 thing types', dict(types))
T = {3004:'POSS',9:'SPOS',3001:'TROO',2035:'BAR1',2001:'SHOT',2012:'MEDI',2011:'STIM',2014:'BON1',2015:'BON2',2018:'ARM1',2019:'ARM2',2007:'CLIP',2008:'SHEL',2048:'AMMO',2049:'SBOX',2046:'BROK',2028:'COLU',48:'ELEC',34:'CAND',35:'CBRA',10:'PLAY',12:'PLAY',15:'PLAY',24:'POL5',2003:'LAUN',2010:'ROCK',2002:'MGUN',2005:'CSAW',2013:'SOUL',2024:'PINS',2045:'PVIS',2025:'SUIT',2026:'PMAP',8:'BPAK',5:'BKEY',6:'YKEY',13:'RKEY',46:'TRED',44:'TBLU',2047:'CELL',3002:'SARG',58:'SARG'}
need = {'PLAY','PUNG','PISG','PISF','SHTG','SHTF','PUFF','BLUD','TFOG','IFOG','BAL1','BEXP','MISL'}
unk = [t for t in types if t not in T and t not in (1,2,3,4,11,14)]
for t in types:
    if t in T: need.add(T[t])
ssz = sum(s for nm, o, s in sprites if nm[:4] in need); sn = sum(1 for nm, o, s in sprites if nm[:4] in need)
print(f'E1M1 sprites: prefixes {sorted(need)} unknown types {unk}; {sn} of {len(sprites)} lumps, {ssz} B')
sfx = sum(s for nm, o, s in L if nm.startswith('DS')); print('all DS sfx', sfx, 'D_E1M1', L[idx['D_E1M1']][2])
