"""Derived inputs (original files are never modified).

drosophila_session_HHfix.json: the original DrosophilaData/session.json with ONE change: the
time column's legacy Luxon format 'YYYY-MM-DD H:mm:s' -> 'YYYY-MM-DD HH:mm:ss'. The current
app parses legacy formats with dayjs in strict mode, where 'H' rejects zero-padded hours
(00-09), so 1661/3952 rows (every 00:00-09:59 timestamp) become null in v75.2.
"""
import json, os
here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, '..', 'results', 'worked_example', 'inputs')
os.makedirs(out, exist_ok=True)
src = '/Users/dcum007/Documents/Circadian/RACiR/Paper/DrosophilaData/session.json'
d = json.load(open(src))
n = 0
for c in d['data']:
    if c.get('type') == 'time' and c.get('timeFormat') == 'YYYY-MM-DD H:mm:s':
        c['timeFormat'] = 'YYYY-MM-DD HH:mm:ss'; n += 1
assert n == 1, n
json.dump(d, open(os.path.join(out, 'drosophila_session_HHfix.json'), 'w'))
print('patched', n, 'column')

# drosophila_session_HHfix_fft.json: as above, plus an FFT plot (the Scyphax session's FFT plot
# JSON, re-wired to the same binned series the session's periodogram uses; x-range 10-30 h).
import copy
scy = json.load(open('/Users/dcum007/Documents/Circadian/RACiR/Paper/Scyphax data/FORJAMES R code from Rachel/session.json'))
fft = copy.deepcopy(next(p for p in scy['plots'] if p['type'] == 'fft'))
pg = next(p for p in d['plots'] if p['type'] == 'periodogram')
fft['id'] = max(p['id'] for p in d['plots']) + 1
fft['name'] = 'FFT_added'
fft['x'], fft['y'] = pg['x'], pg['y'] + pg['height'] + 30
fft['plot']['xlimsIN'] = [10, 30]
src_x, src_y = pg['plot']['data'][0]['x'], pg['plot']['data'][0]['y']
fd = fft['plot']['data'][0]
fd['x'] = copy.deepcopy(src_x); fd['y'] = copy.deepcopy(src_y)
maxid = max(c['id'] for c in d['data'])
for k in ('x', 'y'):
    for pl in d['plots']:
        for dd in pl['plot'].get('data', []):
            maxid = max(maxid, dd.get(k, {}).get('id', 0))
fd['x']['id'] = maxid + 1; fd['y']['id'] = maxid + 2
d['plots'].append(fft)
json.dump(d, open(os.path.join(out, 'drosophila_session_HHfix_fft.json'), 'w'))
print('added FFT plot')
