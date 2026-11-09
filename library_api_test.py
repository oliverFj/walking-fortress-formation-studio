"""Targeted checks for local requests and immutable library activation."""
import copy
import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from library_api import LibraryService, activate, save_appearance, version_appearance
from server import Handler, StudioServer


class LibraryAPITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='library-api-', dir=Path(__file__).parent / 'checks')
        self.root = Path(self.temp.name).resolve()
        self.assets = self.root / 'assets'
        self.assets.mkdir()
        self.registry = {"schema":"walking-fortress-characters-v1", "defaultCharacter":"old-pike",
            "roles":{"pike":"old-pike","shot":"old-shot"}, "characters":{
                "old-pike":{"manifest":"old-pike/character.json","label":"Pikener"},
                "old-shot":{"manifest":"old-shot/character.json","label":"Musketer"}}}
        self.write(self.assets/'characters.json', self.registry)
        self.document = {"schema":"walking-fortress-formation-character-v2", "clips":{
            "stand":{"kind":"idle","duration":1,"directions":[[{"body":{"rect":[0,0,1,1],"pivot":[0,1]}}]]},
            "march":{"kind":"walk","duration":1,"directions":[[{"body":{"rect":[0,0,1,1],"pivot":[0,1]}}]]}}}
        self.manifest = self.assets/'library/new/version/character.json'
        self.write(self.manifest, self.document)
        self.library = {"characters":[{"id":"new","label":"Ny figur","versions":[{"id":"version","characterUrl":"/assets/library/new/version/character.json"}]}]}

    def write(self, path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data), encoding='utf-8')

    def tearDown(self):
        self.temp.cleanup()

    def test_activate_keeps_other_role_and_does_not_modify_export(self):
        before = self.manifest.read_bytes()
        activate(self.root, self.library, {"characterId":"new","versionId":"version","role":"pike"})
        registry = json.loads((self.assets/'characters.json').read_text())
        self.assertEqual(registry['roles'], {'pike':'new','shot':'old-shot'})
        self.assertEqual(registry['defaultCharacter'], 'new')
        self.assertEqual(set(registry['characters']), {'new','old-shot'})
        self.assertEqual(self.manifest.read_bytes(), before)
        service = LibraryService(self.root)
        class FakeJobs:
            def library(inner): return self.library
            def list_jobs(inner): return []
        service._jobs = FakeJobs()
        self.assertEqual(service.snapshot()['characters'][0]['versions'][0]['activeRoles'], ['pike'])

    def test_action_only_export_stays_in_library_without_replacing_roles(self):
        del self.document['clips']['march']
        self.write(self.manifest, self.document)
        with self.assertRaisesRegex(ValueError, 'ganganimation'):
            activate(self.root,self.library,{"characterId":"new","versionId":"version","role":"pike"})
        self.assertEqual(json.loads((self.assets/'characters.json').read_text()), self.registry)

    def test_activation_rejects_external_and_traversing_manifest(self):
        for path in ('https://example.com/character.json', '/assets/../../character.json'):
            library = copy.deepcopy(self.library)
            library['characters'][0]['versions'][0]['characterUrl'] = path
            with self.assertRaises(ValueError):
                activate(self.root, library, {"characterId":"new","versionId":"version","role":"shot"})

    def test_pike_appearance_saves_without_changing_pack_and_follows_activation(self):
        self.document['pikeAtlas'] = 'pikes.png'
        self.write(self.manifest, self.document)
        before = self.manifest.read_bytes()
        style = {'darkness':.6,'opacity':1.5,'widthScale':1.8}
        config = {'characterId':'new','versionId':'version','pikeAppearance':style}
        result = save_appearance(self.root, self.library, config)
        self.assertFalse(result['active'])
        self.assertEqual(self.manifest.read_bytes(), before)
        self.assertEqual(version_appearance(self.root, 'new', self.library['characters'][0]['versions'][0]), style)
        activate(self.root, self.library, {'characterId':'new','versionId':'version','role':'pike'})
        self.assertEqual(json.loads((self.assets/'characters.json').read_text())['characters']['new']['pikeAppearance'],style)
        config['pikeAppearance']={'darkness':.2,'opacity':.7,'widthScale':.8}
        result=save_appearance(self.root,self.library,config)
        self.assertTrue(result['active'])
        self.assertEqual(json.loads((self.assets/'characters.json').read_text())['characters']['new']['pikeAppearance'],config['pikeAppearance'])
        self.assertEqual(self.manifest.read_bytes(),before)

    def test_pike_appearance_rejects_nonfinite_values_and_figure_without_pike(self):
        config={'characterId':'new','versionId':'version','pikeAppearance':{'opacity':float('nan')}}
        with self.assertRaisesRegex(ValueError,'ingen separat pike'):
            save_appearance(self.root,self.library,config)
        self.document['pages']=[{'pikeAtlas':'pikes.png'}]
        self.write(self.manifest,self.document)
        for style in ({'opacity':float('nan')},{'widthScale':0},{'darkness':2},{'opacity':True}):
            config['pikeAppearance']=style
            with self.assertRaisesRegex(ValueError,'interval'):
                save_appearance(self.root,self.library,config)
        self.assertFalse((self.assets/'library/appearance.json').exists())

    def test_http_json_contract_and_local_origin(self):
        class FakeService:
            def get(inner, path): return {'characters':[], 'jobs':[]}
            def post(inner, path, data): return {'accepted':data}
        server = StudioServer(('127.0.0.1',0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        def request(method, headers=None, body=None):
            connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=3)
            try:
                connection.request(method, '/api/library/render' if method=='POST' else '/api/library', body=body, headers=headers or {})
                response = connection.getresponse()
                status, payload = response.status, response.read()
                return status,payload
            finally: connection.close()
        try:
            with patch('server.LIBRARY', FakeService()):
                self.assertEqual(request('GET')[0],200)
                self.assertEqual(request('POST',{'Content-Type':'application/json'},'{"path":"character.blend"}')[0],200)
                self.assertEqual(request('POST',{'Content-Type':'application/json','Origin':'https://example.com'},'{}')[0],403)
                self.assertEqual(request('POST',{'Content-Type':'application/json','Host':'attacker.invalid'},'{}')[0],403)
                self.assertEqual(request('POST',{'Content-Type':'text/plain'},'{}')[0],400)
                self.assertEqual(request('POST',{'Content-Type':'application/json'},'[]')[0],400)
                self.assertEqual(request('POST',{'Content-Type':'application/json'},'{bad')[0],400)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)


if __name__ == '__main__': unittest.main()
