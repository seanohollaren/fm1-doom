# SPDX-License-Identifier: GPL-3.0-only
# Survey (2026-10-09, NOTES.md): does any Freedoom Phase 1 level fit the FM-1 build? Cuts each level the way
# tools/cut_wad.py cuts Doom's E1M1, plus what Freedoom needs before the converter takes it at all (sidedefs in
# linedef order, texture offsets normalised, lumps the converter ignores dropped, sounds at 5.5 kHz), converts it
# with a whd_gen built WITH assertions, and prints the size or the limit it hit. The music is a stand-in from
# doom1.wad (Freedoom's is MIDI, which whd_gen cannot read), so the outputs are for measuring only: never ship them.
#   tools/freedoom_survey.py FREEDOOM1.WAD OUT_DIR WHD_GEN [E1M1 ...]
import struct, sys, subprocess, os
SRC = sys.argv[1]; OUT = sys.argv[2]; WG = sys.argv[3]; ONLY = sys.argv[4:] 
d = open(SRC, 'rb').read()
n, diro = struct.unpack('<ii', d[4:12])
L = []
for i in range(n):
    o, s, nm = struct.unpack('<ii8s', d[diro+16*i:diro+16*i+16])
    L.append([nm.rstrip(b'\0').decode('latin1').upper(), d[o:o+s]])
names = [x[0] for x in L]
def nm8(b): return b.split(b'\0')[0].decode('latin1').upper()
pn = L[names.index('PNAMES')][1]; pnames = [nm8(pn[4+8*i:12+8*i]) for i in range(struct.unpack('<i', pn[:4])[0])]
defs = []
for tl in ('TEXTURE1', 'TEXTURE2'):
    if tl not in names: continue
    t1 = L[names.index(tl)][1]; nt = struct.unpack('<i', t1[:4])[0]
    for i in range(nt):
        o = struct.unpack('<i', t1[4+4*i:8+4*i])[0]
        pc = struct.unpack('<h', t1[o+20:o+22])[0]
        defs.append((nm8(t1[o:o+8]), t1[o:o+22+10*pc], [pnames[struct.unpack('<h', t1[o+22+10*j+4:o+22+10*j+6])[0]] for j in range(pc)]))
tn = {x[0] for x in defs}
ANIM_T = [['SLADRIP1','SLADRIP2','SLADRIP3'],['BLODGR1','BLODGR2','BLODGR3','BLODGR4'],['GSTFONT1','GSTFONT2','GSTFONT3'],['FIRELAV3','FIRELAVA'],['FIREMAG1','FIREMAG2','FIREMAG3'],['FIREBLU1','FIREBLU2'],['ROCKRED1','ROCKRED2','ROCKRED3'],['BLODRIP1','BLODRIP2','BLODRIP3','BLODRIP4'],['FIREWALA','FIREWALB','FIREWALL'],['WFALL1','WFALL2','WFALL3','WFALL4'],['SFALL1','SFALL2','SFALL3','SFALL4'],['DBRAIN1','DBRAIN2','DBRAIN3','DBRAIN4']]
ANIM_F = [['NUKAGE1','NUKAGE2','NUKAGE3'],['FWATER1','FWATER2','FWATER3','FWATER4'],['SWATER1','SWATER2','SWATER3','SWATER4'],['LAVA1','LAVA2','LAVA3','LAVA4'],['BLOOD1','BLOOD2','BLOOD3'],['RROCK05','RROCK06','RROCK07','RROCK08'],['SLIME01','SLIME02','SLIME03','SLIME04'],['SLIME05','SLIME06','SLIME07','SLIME08'],['SLIME09','SLIME10','SLIME11','SLIME12']]
T = {3004:['POSS','CLIP'],9:['SPOS','SHOT'],3001:['TROO','BAL1'],3002:['SARG'],58:['SARG'],3006:['SKUL'],3005:['HEAD','BAL2'],3003:['BOSS','BAL7'],16:['CYBR'],7:['SPID'],
     2035:['BAR1','BEXP'],2001:['SHOT'],2002:['MGUN','CHGG','CHGF'],2003:['LAUN','MISG','MISF','MISL'],2004:['PLAS','PLSG','PLSF','PLSS','PLSE'],2005:['CSAW','SAWG'],2006:['BFUG','BFGG','BFGF','BFS1','BFE1','BFE2'],
     2012:['MEDI'],2011:['STIM'],2014:['BON1'],2015:['BON2'],2018:['ARM1'],2019:['ARM2'],2007:['CLIP'],2008:['SHEL'],2048:['AMMO'],2049:['SBOX'],2046:['BROK'],2010:['ROCK'],2047:['CELL'],17:['CELP'],8:['BPAK'],
     2013:['SOUL'],2022:['PINV'],2023:['PSTR'],2024:['PINS'],2025:['SUIT'],2026:['PMAP'],2045:['PVIS'],5:['BKEY'],6:['YKEY'],13:['RKEY'],40:['BSKU'],39:['YSKU'],38:['RSKU'],
     2028:['COLU'],48:['ELEC'],34:['CAND'],35:['CBRA'],24:['POL5'],10:['PLAY'],12:['PLAY'],15:['PLAY'],18:['POSS'],19:['SPOS'],20:['TROO'],21:['SARG'],22:['HEAD'],23:['SKUL'],
     30:['COL1'],31:['COL2'],32:['COL3'],33:['COL4'],36:['COL5'],37:['COL6'],41:['CEYE'],42:['FSKU'],43:['TRE1'],47:['SMIT'],54:['TRE2'],44:['TBLU'],45:['TGRN'],46:['TRED'],55:['SMBT'],56:['SMGT'],57:['SMRT'],
     25:['POL1'],26:['POL6'],27:['POL4'],28:['POL2'],29:['POL3'],49:['GOR1'],50:['GOR2'],51:['GOR3'],52:['GOR4'],53:['GOR5'],59:['GOR2'],60:['GOR4'],61:['GOR3'],62:['GOR5'],63:['GOR1'],2:[],3:[],4:[],1:[],11:[],14:[]}
SFX = 'SGTSIT SGTATK SGTDTH DMPAIN DMACT CACSIT CACDTH RLAUNC RXPLOD BRSSIT BRSDTH SKLATK SKLDTH GETPOW SAWUP SAWIDL SAWFUL SAWHIT PLASMA PISTOL SHOTGN SGCOCK PUNCH BAREXP FIRSHT FIRXPL PSTART PSTOP DOROPN DORCLS STNMOV SWTCHN SWTCHX PLPAIN PLDETH OOF NOWAY ITEMUP WPNUP SLOP TELEPT POSIT1 POSIT2 POSIT3 BGSIT1 BGSIT2 POPAIN PODTH1 PODTH2 PODTH3 BGDTH1 BGDTH2 POSACT BGACT CLAW TINK'.split()
MAPL = [None]
def norm(sd):
    x, y = struct.unpack('<hh', sd[:4])
    x = (x % 256) & ~1; y = (y % 128) & ~1
    return struct.pack('<hh', x, y) + sd[4:]
UNUSED = set('FREEDOOM DBIGFONT DEHACKED STKEYS6 STKEYS7 STKEYS8 STCFN096 STCFN123 STCFN124 STCFN125 PRBOOM M_GENERL M_SETUP M_KEYBND M_WEAP M_STAT M_AUTO M_ENEM M_MESS M_CHAT M_HORSEN M_VERSEN M_LOKSEN M_ACCEL M_ABOUT M_CHATM M_COMPAT M_DEMOS M_DMFLAG M_ETCOPT M_FEAT M_GSET M_HUD M_JOYSET M_LDSV M_MENUS M_MOUSE M_MULTI M_PLAYER M_SERIAL M_SOUND M_STATUS M_TCPIP M_VIDEO M_WAD M_WADOPT M_CRISPY INTERPIC'.split())
_d = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'wads', 'doom1.wad'), 'rb').read(); _n, _o = struct.unpack('<ii', _d[4:12]); DOOMMUS = {}
for _i in range(_n):
    o, sz, nm = struct.unpack('<ii8s', _d[_o+16*_i:_o+16*_i+16]); nm = nm.rstrip(b'\0').decode()
    if nm in ('D_E1M1', 'D_INTROA'): DOOMMUS[nm] = _d[o:o+sz]
def cut(mapname, dst):
    m = names.index(mapname); ml = dict(L[m+1:m+11]); ep = mapname[1]
    sky = 'SKY' + ep
    ld = bytearray(ml['LINEDEFS']); osd = ml['SIDEDEFS']; nsd = b''
    for i in range(0, len(ld), 14):
        f, bk = struct.unpack('<HH', ld[i+10:i+14])
        k = len(nsd) // 30
        nsd += norm(osd[f*30:f*30+30])
        if bk != 0xFFFF:
            nsd += norm(osd[bk*30:bk*30+30]); struct.pack_into('<HH', ld, i+10, k, k+1)
        else: struct.pack_into('<HH', ld, i+10, k, 0xFFFF)
    ml['SIDEDEFS'] = nsd; ml['LINEDEFS'] = bytes(ld); MAPL[0] = ml
    sd = ml['SIDEDEFS']; tex = {sky}
    for i in range(0, len(sd), 30):
        for k in (4, 12, 20):
            t = nm8(sd[i+k:i+k+8])
            if t != '-': tex.add(t)
    sec = ml['SECTORS']; fl = set()
    for i in range(0, len(sec), 26):
        for k in (4, 12): fl.add(nm8(sec[i+k:i+k+8]))
    th = ml['THINGS']; types = {}
    for i in range(0, len(th), 10):
        ty, fg = struct.unpack('<hh', th[i+6:i+10]); types[ty] = types.get(ty, 0) + 1
    for t in list(tex):
        for a, b in (('SW1', 'SW2'), ('SW2', 'SW1')):
            if t.startswith(a) and b+t[3:] in tn: tex.add(b+t[3:])
    for g in ANIM_T:
        if tex & set(g): tex |= set(g) & tn
    for g in ANIM_F:
        if fl & set(g): fl |= set(g)
    fl.add('F_SKY1')
    usedp = set()
    for nm, raw, ps in defs:
        if nm in tex: usedp |= set(ps)
    need = {'PUNG','PISG','PISF','PUFF','BLUD','TFOG','IFOG'}
    unk = []
    for t in types:
        if t in T: need |= set(T[t])
        else: unk.append(t)
    if 'SHOT' in need: need |= {'SHTG','SHTF'}
    out = []; sect = None; skipmap = 0; inmap = 0
    if sky != 'SKY1': tex.discard('SKY1')
    for i, (nm, data) in enumerate(L):
        if nm in ('S_START','F_START','P_START'): sect = nm[0]; out.append((nm, data)); continue
        if nm in ('F1_START','P1_START','F2_START','P2_START','F3_START','P3_START'): out.append((nm, data)); continue
        if nm in ('S_END','F_END','P_END'): sect = None; out.append((nm, data)); continue
        if nm in ('F1_END','P1_END','F2_END','P2_END','F3_END','P3_END'): out.append((nm, data)); continue
        if len(nm) == 4 and nm[0] == 'E' and nm[2] == 'M':
            if nm != mapname: skipmap = 10; continue
            nm = 'E1M1'; inmap = 10
        elif skipmap: skipmap -= 1; continue
        elif inmap: inmap -= 1; data = MAPL[0][nm]
        if nm.startswith('D_'):
            if nm == 'D_' + mapname: nm = 'D_E1M1'
            elif nm == 'D_INTRO' and 'D_INTROA' not in names: nm = 'D_INTROA'
            elif nm != 'D_INTROA': continue
        if nm.startswith('D_') and data[:4] == b'MThd': data = DOOMMUS[nm]   # SURVEY ONLY: stand-in music of a similar size
        if nm.startswith('DEMO') or (sect is None and nm in UNUSED): continue
        if nm.startswith('DS') and nm[2:] not in SFX: continue
        if nm.startswith('DP'): continue
        drop = ('CREDIT','HELP1','HELP2','WIMAP0','VICTORY','PFUB','END','WIA','WIURH','WISPLAT','DMXGUS','WI', 'TEXTURE2', 'BOSSBACK', 'HELP')
        if sect is None and nm.startswith(drop) and nm not in ('ENDOOM',): continue
        if sect == 'S' and nm[:4] == 'PLAY':
            if nm[4] in 'NW': out.append((nm, data))
            elif nm == 'PLAYA1':
                tiny = struct.pack('<hhhhi', 1, 1, 0, 0, 12) + bytes([0, 1, 0, 0, 0, 0xFF])
                for letter in 'ABCDEFGHIJKLMOPQRSTUV': out.append(('PLAY' + letter + '0', tiny))
            continue
        if sect == 'S' and nm[:4] not in need: continue
        if sect == 'F' and nm not in fl: continue
        if sect == 'P' and nm not in usedp: continue
        if nm == 'TEXTURE1':
            kd = [x for x in defs if x[0] in tex]
            newp = [p for p in pnames if p in usedp]; pmap = {p: i for i, p in enumerate(newp)}
            body = b''; table = b''; base = 4 + 4*len(kd)
            for tnm, raw, ps in kd:
                raw = bytearray(raw)
                if tnm == sky: raw[0:8] = b'SKY1\0\0\0\0'
                for j, p in enumerate(ps): struct.pack_into('<h', raw, 22+10*j+4, pmap[p])
                table += struct.pack('<i', base + len(body)); body += bytes(raw)
            data = struct.pack('<i', len(kd)) + table + body
        if nm.startswith('DS') and len(data) > 8 + 32 and data[0] == 3:
            rate, count = struct.unpack('<HI', data[2:8])
            body = data[8 + 16:8 + count - 16]
            while rate >= 11025:
                body = bytes((body[i] + body[i + 1] + 1) >> 1 for i in range(0, len(body) - 1, 2)); rate //= 2
            half = body
            pad0, pad1 = bytes([half[0]]) * 16 if half else b'', bytes([half[-1]]) * 16 if half else b''
            data = struct.pack('<HHI', 3, rate, len(half) + 32) + pad0 + half + pad1
        out.append((nm, data))
    out = [(nm, struct.pack('<i', len(newp)) + b''.join(p.encode().ljust(8, b'\0') for p in newp)) if nm == 'PNAMES' else (nm, dd) for nm, dd in out]
    blob = b''; dirb = b''
    for nm, data in out:
        dirb += struct.pack('<ii8s', 12 + len(blob), len(data), nm.encode('latin1')); blob += data
    open(dst, 'wb').write(b'IWAD' + struct.pack('<ii', len(out), 12 + len(blob)) + blob + dirb)
    return dict(tex=len(tex), flats=len(fl), patches=len(usedp), things=sum(types.values()), sides=len(sd)//30, sprites=len(need), unk=unk, sectors=len(sec)//26, wad=12+len(blob)+len(dirb))
maps = [x for x in names if len(x) == 4 and x[0] == 'E' and x[2] == 'M']
for mp in maps:
    if ONLY and mp not in ONLY: continue
    dst = f'{OUT}/{mp}.wad'
    info = cut(mp, dst)
    r = subprocess.run([WG, dst, f'{OUT}/{mp}.whx'], capture_output=True, text=True, errors='replace')
    open(f'{OUT}/{mp}.log', 'w').write(r.stdout + r.stderr)
    if r.returncode == 0: res = f"WHX {os.path.getsize(f'{OUT}/{mp}.whx')}"
    else:
        tail = [l for l in (r.stdout + r.stderr).splitlines() if l.strip()][-1][:150]
        res = f'FAIL({r.returncode}) {tail}'
    print(mp, f"sides {info['sides']:5d} sec {info['sectors']:4d} things {info['things']:4d} tex {info['tex']:3d} flats {info['flats']:3d} patches {info['patches']:3d} spr {info['sprites']:2d} unk {info['unk']} | {res}", flush=True)
