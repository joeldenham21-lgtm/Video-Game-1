"""Old Grey coat: same mesh/UVs as sp_bear (deterministic build), silvered + scarred pattern.
Only assets/textures/fauna/bear_oldgrey_albedo.png is kept (the duplicate glb/json are deleted after the build)."""
from sp_bear import *  # noqa: F401,F403
from sp_bear import SPEC as _S, pattern_old

SPEC = dict(_S, name="bear_oldgrey", pattern=pattern_old)
