"""Cover the confinement the cage holds on a host whose kernel has been emptied of the profile.

The stack asks for the profile by name at start, and the kernel answers from the policy it holds.
A host that comes back holding the installed file alone is therefore the state the cage must still
start from.
"""

from conftest import cage, devcontainer_up


def test_the_cage_is_confined_after_the_kernel_loses_the_profile(a_host_that_has_run_o3s):
    """A host holding the installed profile alone raises a cage the kernel confines."""
    raised = devcontainer_up()

    confinement = cage(raised["containerId"]).file("/proc/self/attr/current")

    assert confinement.content_string.strip() == "o3s-cage (enforce)"
