import struct, sys
args = [a for a in sys.argv[1:] if not a.startswith('--')]
src, dst, level = args[0], args[1], int(args[2])
HALF_SFX = '--half-sfx' in sys.argv     # sound effects at half their sample rate (11025 -> 5512 Hz): half the size, duller
KEEP_TITLE = level == 6                 # level 6 = level 5 (no intermission art) with the title picture kept
d = open(src, 'rb').read()
n, diro = struct.unpack('<ii', d[4:12])
L = []
for i in range(n):
    o, s, nm = struct.unpack('<ii8s', d[diro+16*i:diro+16*i+16])
    L.append([nm.rstrip(b'\0').decode().upper(), d[o:o+s]])
names = [x[0] for x in L]
ix = lambda nm: names.index(nm)
m = ix('E1M1'); ml = dict(L[m+1:m+11])
def nm8(b): return b.rstrip(b'\0').decode().upper()
sd = ml['SIDEDEFS']; tex = {'SKY1'}
for i in range(0, len(sd), 30):
    for k in (4, 12, 20):
        t = nm8(sd[i+k:i+k+8])
        if t != '-': tex.add(t)
sec = ml['SECTORS']; fl = set()
for i in range(0, len(sec), 26):
    for k in (4, 12): fl.add(nm8(sec[i+k:i+k+8]))
th = ml['THINGS']; types = {struct.unpack('<h', th[i+6:i+8])[0] for i in range(0, len(th), 10)}
pn = L[ix('PNAMES')][1]; pnames = [nm8(pn[4+8*i:12+8*i]) for i in range(struct.unpack('<i', pn[:4])[0])]
t1 = L[ix('TEXTURE1')][1]; nt = struct.unpack('<i', t1[:4])[0]
offs = [struct.unpack('<i', t1[4+4*i:8+4*i])[0] for i in range(nt)]
defs = []
for o in offs:
    pc = struct.unpack('<h', t1[o+20:o+22])[0]
    defs.append((nm8(t1[o:o+8]), t1[o:o+22+10*pc], [pnames[struct.unpack('<h', t1[o+22+10*j+4:o+22+10*j+6])[0]] for j in range(pc)]))
tn = {x[0] for x in defs}
for t in list(tex):
    for a, b in (('SW1', 'SW2'), ('SW2', 'SW1')):
        if t.startswith(a) and b+t[3:] in tn: tex.add(b+t[3:])
ANIM_T = [['SLADRIP1','SLADRIP2','SLADRIP3'],['BLODGR1','BLODGR2','BLODGR3','BLODGR4'],['GSTFONT1','GSTFONT2','GSTFONT3'],['FIRELAV3','FIRELAVA'],['FIREMAG1','FIREMAG2','FIREMAG3'],['FIREBLU1','FIREBLU2'],['ROCKRED1','ROCKRED2','ROCKRED3']]
ANIM_F = [['NUKAGE1','NUKAGE2','NUKAGE3'],['FWATER1','FWATER2','FWATER3','FWATER4'],['SWATER1','SWATER2','SWATER3','SWATER4'],['LAVA1','LAVA2','LAVA3','LAVA4'],['BLOOD1','BLOOD2','BLOOD3']]
for g in ANIM_T:
    if tex & set(g): tex |= set(g) & tn
for g in ANIM_F:
    if fl & set(g): fl |= set(g)
fl.add('F_SKY1')
keep_tex = tn if level < 2 else tex
usedp = set()
for nm, raw, ps in defs:
    if nm in keep_tex: usedp |= set(ps)
T = {3004:'POSS',9:'SPOS',3001:'TROO',2035:'BAR1',2001:'SHOT',2012:'MEDI',2011:'STIM',2014:'BON1',2015:'BON2',2018:'ARM1',2019:'ARM2',2007:'CLIP',2008:'SHEL',2048:'AMMO',2049:'SBOX',2046:'BROK',2028:'COLU',48:'ELEC',35:'CBRA',24:'POL5',2003:'LAUN',2002:'MGUN'}
need = ({'PUNG'} if level >= 3 else {'PLAY','PUNG'}) | {'PUNG','PISG','PISF','SHTG','SHTF','PUFF','BLUD','TFOG','IFOG','BAL1','BEXP','MISL','CHGG','CHGF'} | {T[t] for t in types if t in T}
out = []; sect = None; skipmap = 0
for i, (nm, data) in enumerate(L):
    if nm in ('S_START','F_START','P_START','F1_START','P1_START'): sect = nm[0]; out.append((nm, data)); continue
    if nm in ('S_END','F_END','P_END','F1_END','P1_END'): sect = None if nm in ('S_END','F_END','P_END') else sect; out.append((nm, data)); continue
    if len(nm) == 4 and nm[0] == 'E' and nm[2] == 'M' and nm != 'E1M1': skipmap = 10; continue
    if skipmap: skipmap -= 1; continue
    if nm.startswith('D_') and nm not in ('D_E1M1', 'D_INTROA') and level >= 1: continue   # the level's music and the title jingle (the OPL version)
    if nm.startswith('DEMO') and level >= 1: continue
    if level >= 3:
        if sect == 'S' and nm[:4] in ('POL5','LAUN','MGUN','CHGG','CHGF','MISL'): continue
        SFX = 'PISTOL SHOTGN SGCOCK PUNCH BAREXP FIRSHT FIRXPL PSTART PSTOP DOROPN DORCLS STNMOV SWTCHN SWTCHX PLPAIN PLDETH OOF NOWAY ITEMUP WPNUP SLOP TELEPT POSIT1 POSIT2 POSIT3 BGSIT1 BGSIT2 POPAIN PODTH1 PODTH2 PODTH3 BGDTH1 BGDTH2 POSACT BGACT CLAW TINK'.split()
        if nm.startswith('DS') and nm[2:] not in SFX: continue
        if nm.startswith('DP'): continue
        drop = ('CREDIT','HELP1','HELP2','WIMAP0','VICTORY','PFUB','END','WIA','WIURH','WISPLAT','DMXGUS') + (('WI',) if level >= 5 else ()) + (('TITLEPIC',) if level >= 4 and not KEEP_TITLE else ())
        if sect is None and nm.startswith(drop) and nm not in ('ENDOOM',): continue
    if sect == 'S' and nm[:4] not in need: continue
    if sect == 'F' and level >= 2 and nm not in fl: continue
    if sect == 'P' and level >= 2 and nm not in usedp: continue
    if nm == 'TEXTURE1' and level >= 2:
        kd = [x for x in defs if x[0] in keep_tex]
        newp = [p for p in pnames if p in usedp]; pmap = {p: i for i, p in enumerate(newp)}
        body = b''; table = b''; base = 4 + 4*len(kd)
        for tnm, raw, ps in kd:
            raw = bytearray(raw)
            for j, p in enumerate(ps): struct.pack_into('<h', raw, 22+10*j+4, pmap[p])
            table += struct.pack('<i', base + len(body)); body += bytes(raw)
        data = struct.pack('<i', len(kd)) + table + body
        globals()['newp'] = newp
    if HALF_SFX and nm.startswith('DS') and len(data) > 8 + 32 and data[0] == 3:
        rate, count = struct.unpack('<HI', data[2:8])
        body = data[8 + 16:8 + count - 16]                     # DMX pads 16 bytes each side
        half = bytes((body[i] + body[i + 1] + 1) >> 1 for i in range(0, len(body) - 1, 2))
        pad0, pad1 = bytes([half[0]]) * 16 if half else b'', bytes([half[-1]]) * 16 if half else b''
        data = struct.pack('<HHI', 3, rate // 2, len(half) + 32) + pad0 + half + pad1
    out.append((nm, data))
if level >= 2:
    out = [(nm, struct.pack('<i', len(newp)) + b''.join(p.encode().ljust(8, b'\0') for p in newp)) if nm == 'PNAMES' else (nm, dd) for nm, dd in out]
blob = b''; dirb = b''
for nm, data in out:
    dirb += struct.pack('<ii8s', 12 + len(blob), len(data), nm.encode()); blob += data
open(dst, 'wb').write(b'IWAD' + struct.pack('<ii', len(out), 12 + len(blob)) + blob + dirb)
print(dst, 'lumps', len(out), 'bytes', 12 + len(blob) + len(dirb), 'textures', len(keep_tex), 'sprites', sorted(need))
