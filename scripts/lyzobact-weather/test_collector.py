import datetime as dt
import unittest
from collector import due_centres, parse_observation, collect
UTC=dt.timezone.utc
C={'centreId':'1','regionKey':'a','latitude':55.75,'longitude':37.62,'timeZone':'Europe/Moscow'}
def at(text): return dt.datetime.fromisoformat(text.replace('Z','+00:00'))
NOW=at('2026-10-12T06:02:00Z')
PAYLOAD={'main':{'temp':11.999},'dt':int(at('2026-10-12T05:30:00Z').timestamp())}
class CollectorTests(unittest.TestCase):
 def test_window_and_dedup(self):
  self.assertEqual(len(due_centres([C,dict(C,regionKey='b')],NOW)),1)
  for time in ['05:59:59','06:15:00','10:00:00']:
   self.assertEqual(due_centres([C],at('2026-10-12T'+time+'Z')),[])
 def test_actual_observation_and_freshness(self):
  self.assertEqual(parse_observation(PAYLOAD,C,NOW)['temperature_c'],11.999)
  for payload in [{'main':{'temp':float('nan')},'dt':PAYLOAD['dt']},dict(PAYLOAD,dt=int(at('2026-10-12T02:00:00Z').timestamp())),dict(PAYLOAD,dt=int(at('2026-10-12T06:08:00Z').timestamp())),{'main':{},'dt':PAYLOAD['dt']}]:
   with self.assertRaises(ValueError): parse_observation(payload,C,NOW)
 def test_success_skips_refetch_and_failure_can_retry(self):
  facts={};calls=[]
  def exists(cid,date): return facts.get((cid,date),{}).get('status')=='valid'
  def save(row):
   key=(row['centre_id'],row['local_date'])
   if not exists(*key): facts[key]=row
  def fetch(c): calls.append(c);return PAYLOAD
  collect([C,C],fetch,exists,save,lambda:NOW)
  collect([C],fetch,exists,save,lambda:NOW)
  self.assertEqual(len(calls),1);self.assertEqual(len(facts),1)
  facts.clear()
  def fail(c): raise RuntimeError('secret key URL')
  collect([C],fail,exists,save,lambda:NOW)
  self.assertEqual(next(iter(facts.values()))['status'],'error');self.assertNotIn('secret',str(facts))
  collect([C],fetch,exists,save,lambda:NOW)
  self.assertEqual(next(iter(facts.values()))['status'],'valid')
 def test_crossing_cutoff_does_not_publish_late_measurement(self):
  times=iter([NOW,at('2026-10-12T06:15:00Z')]);saved=[]
  collect([C],lambda c:PAYLOAD,lambda *a:False,saved.append,lambda:next(times))
  self.assertEqual(saved[0]['status'],'error');self.assertIsNone(saved[0]['temperature_c'])

class QuotaTests(unittest.TestCase):
 def test_account_errors_stop_remaining_requests(self):
  import urllib.error
  for code in [401,403,429]:
   calls=[];saved=[]
   def fail(c):
    calls.append(c);raise urllib.error.HTTPError('secret-url',code,'provider',{},None)
   collect([C,dict(C,centreId='2')],fail,lambda *a:False,saved.append,lambda:NOW)
   self.assertEqual(len(calls),1);self.assertEqual(saved[0]['error_code'],'http_'+str(code))

if __name__=='__main__':unittest.main()
