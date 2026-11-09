"""Targeted contracts for the local render queue and immutable library versions."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from library_jobs import LibraryJobs, atomic_json, character_id, source_path

ROOT=Path(__file__).resolve().parent

class LibraryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=ROOT/'checks',prefix='library-unit-')
        self.folder=Path(self.temp.name)
        self.manager=LibraryJobs(ROOT,state_root=self.folder/'jobs',library_root=self.folder/'library')
        self.inspection={'sourceFps':24,'rig':'rig','objects':[{'name':'Soldat','type':'MESH'},{'name':'Pike','type':'MESH'}], 'sourceActions':[{'name':'Walk_1.5m1','frame_range':[0,48]},{'name':'Fire','frame_range':[1,24]}], 'actions':[{'id':'walk_1_5m1','action':'Walk_1.5m1','slot':'OBrig','start':0,'end':47,'loop':True,'kind':'walk','gait':'walk','nominalSpeed':1.5},{'id':'fire','action':'Fire','slot':'OBrig','start':1,'end':24,'loop':False,'kind':'action'}], 'settings':{'rig':'rig','meshes':['Soldat'],'anchor_mesh':'Soldat','clips':[{'name':'walk_1_5m1','action':'Walk_1.5m1','slot':'OBrig','start':0,'end':47,'loop':True,'kind':'walk','gait':'walk','nominalSpeed':1.5}], 'pixels':256,'directions':16,'animation_fps':6,'elevation':30.05,'azimuth':45,'remove_root_motion':True,'root_motion_bone':'root'}}

    def tearDown(self):
        self.manager.close(); self.temp.cleanup()

    def test_config_discovers_all_and_preserves_edits(self):
        result=self.manager._config({'actions':['walk_1_5m1',{'id':'fire','start':8,'end':15}],'options':{'animation_fps':6,'size':100}},self.inspection)
        self.assertEqual(result['totalPairs'],(12+2)*16)
        self.assertEqual(result['settings']['clips'][1]['kind'],'action')
        self.assertFalse(result['settings']['clips'][1]['loop'])
        self.assertEqual(result['settings']['clips'][1]['start'],8)
        self.assertEqual(self.inspection['settings']['clips'][0]['end'],47)

    def test_bad_actions_and_slots_rejected_before_render(self):
        with self.assertRaisesRegex(ValueError,'Ukendt animation'):
            self.manager._config({'actions':['missing']},self.inspection)
        settings=copy.deepcopy(self.inspection['settings']); settings['clips'][0]['slot']='OBother'
        with self.assertRaisesRegex(ValueError,'slot'):
            self.manager._config({'settings':settings},self.inspection)
        settings['clips'][0]['slot']='OBrig'; settings['clips'][0]['end']=49
        with self.assertRaisesRegex(ValueError,'frames'):
            self.manager._config({'settings':settings},self.inspection)

    def test_no_pike_ui_payload_keeps_body_and_normals(self):
        inspection=copy.deepcopy(self.inspection)
        inspection['objects'].append({'name':'Musket','type':'MESH'})
        inspection['settings']['meshes'].append('Musket')
        result=self.manager._config({'pike':None,'pikeStyle':None},inspection)
        self.assertEqual(result['settings']['meshes'],['Soldat','Musket'])
        self.assertNotIn('pike',result['settings'])
        self.assertEqual(result['pikeStyle'],{})

    def test_pike_settings_world_units_validate_and_preserve(self):
        pike={'object':'Pike','butt':[0,0,0],'tip':[0,0,5],'grip':[0,0,1],'width_world':.03,'layer':'front'}
        style={'units':'world','ink':'#123456','paper':'#abcdef','stroke_width':.005,'head_length':.2,'head_width':.1,'head_stroke_width':.004}
        result=self.manager._config({'pike':pike,'pikeStyle':style},self.inspection)
        self.assertEqual(result['settings']['pike']['tip'],[0.,0.,5.])
        self.assertEqual(result['pikeStyle'],style)
        with self.assertRaises(ValueError):
            self.manager._config({'pike':pike,'pikeStyle':{'stroke_width':float('nan')}},self.inspection)

    def test_cancel_is_persistent_and_never_complete(self):
        job={'id':'cancel-unit','status':'queued','phase':'queued','label':'Unit','log':[]}
        self.manager.jobs[job['id']]=job
        self.manager._save(job)
        result=self.manager.cancel(job['id'])
        self.assertEqual(result['status'],'canceled')
        saved=json.loads((self.manager.state/job['id']/'job.json').read_text())
        self.assertEqual(saved['status'],'canceled')
        self.assertEqual(self.manager.cancel(job['id'])['status'],'canceled')

    def test_restart_does_not_claim_incomplete_job_done(self):
        self.manager.close()
        job={'id':'interrupted','status':'running','phase':'render','label':'Unit','log':[]}
        atomic_json(self.manager.state/'interrupted/job.json',job)
        self.manager=LibraryJobs(ROOT,state_root=self.folder/'jobs',library_root=self.folder/'library')
        self.assertEqual(self.manager.status('interrupted')['status'],'failed')
        self.assertIn('afbrudt',self.manager.status('interrupted')['error'])

    def test_shipped_versions_visible_and_roles_correct(self):
        library=self.manager.library()
        characters={c['id']:c for c in library['characters']}
        self.assertEqual(characters['pikeman']['versions'][0]['activeRoles'],['pike'])
        self.assertEqual(characters['musketeer']['versions'][0]['activeRoles'],['shot'])
        self.assertTrue(Path(characters['pikeman']['versions'][0]['sourcePath']).is_file())
        self.assertFalse(self.manager.index_path.exists())

    def test_shipped_versions_survive_registry_switch(self):
        actual=Path.read_text
        replacement={'schema':'walking-fortress-characters-v1','roles':{'pike':'new-pikeman'},'characters':{}}
        def read(path,*args,**kwargs):
            if path==ROOT/'assets/characters.json':
                return json.dumps(replacement)
            return actual(path,*args,**kwargs)
        with patch.object(Path,'read_text',read):
            library=self.manager.library()
        self.assertEqual({c['id'] for c in library['characters']},{'pikeman','musketeer'})
        self.assertTrue(all(not v['activeRoles'] for c in library['characters'] for v in c['versions']))

    def test_close_rejects_new_work(self):
        self.manager.close()
        with self.assertRaisesRegex(ValueError,'lukket'):
            self.manager.submit({})

    def test_path_and_id_inputs(self):
        self.assertEqual(character_id('../../En ny figur'),'en-ny-figur')
        with self.assertRaises(ValueError):
            source_path(str(ROOT/'server.py'))
        with self.assertRaises(KeyError):
            self.manager.status('missing')

if __name__=='__main__':
    unittest.main()
