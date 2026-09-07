"""Raise o3s the way this host's editor raises it and hand the running cage to a test.

This suite restarts the o3s this host already runs, and leaves it standing at the end, since the
host it runs on is discarded with the job.
"""

import json
import subprocess
from pathlib import Path

import pytest
import testinfra

REPO = Path(__file__).resolve().parents[1]
PROFILE_FILE = REPO / ".devcontainer/apparmor.conf"
PROFILE_NAME = "o3s-cage"
POLICY = Path("/sys/kernel/security/apparmor/policy/profiles")


def devcontainer_up():
    """Raise the stack, and report what the CLI says it raised."""
    raising = subprocess.run(
        ["devcontainer", "up", "--workspace-folder", REPO],
        capture_output=True,
        text=True,
    )
    # fail with the refusal the CLI reports
    assert raising.returncode == 0, raising.stdout or raising.stderr
    return json.loads(raising.stdout)


def cage(container_id):
    """Address the container the stack runs the cage in."""
    return testinfra.get_host(f"docker://{container_id}")


def profile_is_loaded():
    """Read the policy this host's kernel lays out, where every load names the profile afresh."""
    return any(POLICY.glob(f"{PROFILE_NAME}.*"))


@pytest.fixture
def a_host_that_has_run_o3s():
    """Leave this host holding the installed profile, as a restart that empties the kernel does."""
    raised = devcontainer_up()

    # read a loaded profile first, so the reading below carries weight
    assert profile_is_loaded()

    subprocess.run(["docker", "rm", "-f", raised["containerId"]], check=True)
    subprocess.run(["sudo", "apparmor_parser", "-R", PROFILE_FILE], check=True)

    # hold the arranged state to what it claims, so a test reads a kernel that lost the profile
    assert not profile_is_loaded()
    assert Path("/etc/apparmor.d", PROFILE_NAME).is_file()
