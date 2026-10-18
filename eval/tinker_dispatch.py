"""Process-local dispatch limits for the exact pinned experimental SDK.

ServiceClient ignores max_retries. Its holder has another retry loop beneath
SamplingClient's RetryConfig, and the generated HTTP client defaults to ten
retries. Limit all three without changing the installed package or any ledger.
These deliberately private adapters fail closed on a different SDK version.
Read-only future polling remains polling; it cannot submit another model job.
"""
from importlib.metadata import version


def install_single_dispatch_policy():
    if version('tinker') != '0.32.0':
        raise ValueError('Single-dispatch policy requires pinned Tinker 0.32.0')
    from tinker._client import AsyncTinker
    from tinker.lib.internal_client_holder import InternalClientHolder
    from tinker.lib.public_interfaces.sampling_client import SamplingClient
    if getattr(AsyncTinker.request, '_briefstamp_single_dispatch', False):
        return
    request = AsyncTinker.request
    sample = SamplingClient._send_asample_request

    async def request_once(self, cast_to, options, **kwargs):
        return await request(self, cast_to,
            options.model_copy(update={'max_retries': 0}), **kwargs)

    async def execute_once(self, func, *args, **kwargs):
        return await func(*args, **kwargs)

    async def sample_once(self, *args, **kwargs):
        result = await sample(self, *args, **kwargs)
        if result is None:
            # SDK returns None on backpressure/billing, then loops internally.
            raise RuntimeError('Sampling dispatch stopped; reservation retained, no backpressure retry')
        return result

    request_once._briefstamp_single_dispatch = True
    AsyncTinker.request = request_once
    InternalClientHolder.execute_with_retries = execute_once
    SamplingClient._send_asample_request = sample_once
