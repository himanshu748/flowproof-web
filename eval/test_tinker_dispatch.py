"""Injected failures through the real pinned SDK; no external network."""
import asyncio
import importlib.util
import unittest
from unittest.mock import patch
from tinker_dispatch import install_single_dispatch_policy


@unittest.skipUnless(importlib.util.find_spec('tinker'), 'Pinned optional SDK absent')
class SingleDispatch(unittest.TestCase):
    def test_timeout_makes_one_actual_http_attempt_and_one_holder_attempt(self):
        import httpx
        from tinker._client import AsyncTinker
        from tinker._models import FinalRequestOptions
        from tinker.lib.internal_client_holder import InternalClientHolder
        from tinker.lib.public_interfaces.sampling_client import SamplingClient
        from tinker.types.client_config_response import ClientConfigResponse
        original = (AsyncTinker.request, InternalClientHolder.execute_with_retries,
                    SamplingClient._send_asample_request)
        counts = {'http': 0, 'holder': 0}
        async def exercise():
            async def fail_http(request):
                counts['http'] += 1
                raise httpx.ReadTimeout('Injected offline timeout', request=request)
            async def fail_holder():
                counts['holder'] += 1
                raise asyncio.TimeoutError('Injected offline timeout')
            install_single_dispatch_policy()
            async with httpx.AsyncClient(transport=httpx.MockTransport(fail_http)) as transport:
                client = AsyncTinker(api_key='tml-synthetic-not-a-live-key',
                    _client_config=ClientConfigResponse(use_pyqwest_transport=False),
                    http_client=transport)
                with self.assertRaises(Exception):
                    await client.request(dict, FinalRequestOptions.construct(
                        method='post', url='/offline-test', json_data={}))
            with self.assertRaises(asyncio.TimeoutError):
                await InternalClientHolder.execute_with_retries(None, fail_holder)
        with patch.object(AsyncTinker, 'request', original[0]), \
             patch.object(InternalClientHolder, 'execute_with_retries', original[1]), \
             patch.object(SamplingClient, '_send_asample_request', original[2]):
            asyncio.run(exercise())
        self.assertEqual(counts, {'http': 1, 'holder': 1})
