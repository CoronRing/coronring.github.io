"""
Create the Oracle always-free infrastructure the particle-wave service runs on.

    python infra/provision.py            # ARM, 4 OCPU / 24 GB
    python infra/provision.py --micro    # AMD fallback, 1 OCPU / 1 GB
    python infra/provision.py --show     # report what exists, change nothing

Creates, in order: a VCN, an internet gateway, a route table, a security list
opening 22/80/443, a public subnet, and one compute instance. Every step is
find-or-create keyed on display name, so re-running finishes a partial attempt
instead of building a second copy.

## On capacity

`VM.Standard.A1.Flex` is the interesting shape — 4 ARM cores and 24 GB, free
forever — and it is also frequently unobtainable in busy regions. Oracle
answers `OutOfHostCapacity`, which is a real answer rather than a transient
one, so this fails fast and tells you to retry later or use `--micro`. The
micro shape is always available but has 1 GB of RAM, which is tight for
numpy + scipy + OpenCV.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import oci

sys.path.insert(0, str(Path(__file__).resolve().parent))

from oci_common import (  # noqa: E402
    PREFIX,
    find,
    load_config,
    retry,
    ssh_public_key,
    wait_until,
)

STATE_FILE = Path(__file__).resolve().parent / "state.json"

VCN_CIDR = "10.0.0.0/16"
SUBNET_CIDR = "10.0.1.0/24"
OPEN_PORTS = [22, 80, 443]

ARM = {"shape": "VM.Standard.A1.Flex", "ocpus": 4, "memory_gb": 24, "arch": "aarch64"}
MICRO = {"shape": "VM.Standard.E2.1.Micro", "ocpus": 1, "memory_gb": 1, "arch": "x86_64"}


def networking(net, compartment: str) -> tuple[str, str]:
    """Create (or find) the VCN and a public subnet. Returns (vcn_id, subnet_id)."""
    vcn_name = f"{PREFIX}-vcn"
    vcns = retry(lambda: net.list_vcns(compartment_id=compartment).data, what="list VCNs")
    vcn = find(vcns, vcn_name)

    if vcn:
        print(f"  vcn            reuse  {vcn.display_name}")
    else:
        print(f"  vcn            create {vcn_name}")
        vcn = retry(
            lambda: net.create_vcn(
                oci.core.models.CreateVcnDetails(
                    compartment_id=compartment,
                    cidr_block=VCN_CIDR,
                    display_name=vcn_name,
                    dns_label="pwvcn",
                )
            ).data,
            what="create VCN",
        )
        wait_until(
            lambda: net.get_vcn(vcn.id).data,
            lambda v: v.lifecycle_state == "AVAILABLE",
            label="vcn",
            timeout=180,
        )

    # Internet gateway — without one the subnet has no route off the box.
    gw_name = f"{PREFIX}-igw"
    gateways = retry(
        lambda: net.list_internet_gateways(compartment_id=compartment, vcn_id=vcn.id).data,
        what="list internet gateways",
    )
    gateway = find(gateways, gw_name)
    if gateway:
        print(f"  gateway        reuse  {gateway.display_name}")
    else:
        print(f"  gateway        create {gw_name}")
        gateway = retry(
            lambda: net.create_internet_gateway(
                oci.core.models.CreateInternetGatewayDetails(
                    compartment_id=compartment,
                    vcn_id=vcn.id,
                    is_enabled=True,
                    display_name=gw_name,
                )
            ).data,
            what="create internet gateway",
        )

    # Default route out. Written to the VCN's default route table rather than
    # a new one, so the subnet needs no extra wiring.
    print("  route table    update default -> 0.0.0.0/0 via gateway")
    retry(
        lambda: net.update_route_table(
            vcn.default_route_table_id,
            oci.core.models.UpdateRouteTableDetails(
                route_rules=[
                    oci.core.models.RouteRule(
                        destination="0.0.0.0/0",
                        destination_type="CIDR_BLOCK",
                        network_entity_id=gateway.id,
                        description="default route to the internet",
                    )
                ]
            ),
        ).data,
        what="update route table",
    )

    # Security list. OCI's default allows 22 only; the service needs 80/443.
    print(f"  security list  update default -> open {OPEN_PORTS}")
    ingress = [
        oci.core.models.IngressSecurityRule(
            protocol="6",  # TCP
            source="0.0.0.0/0",
            description=f"port {port}",
            tcp_options=oci.core.models.TcpOptions(
                destination_port_range=oci.core.models.PortRange(min=port, max=port)
            ),
        )
        for port in OPEN_PORTS
    ]
    # ICMP path-MTU messages: dropping these causes hangs on larger responses
    # that look like random timeouts rather than a firewall problem.
    ingress.append(
        oci.core.models.IngressSecurityRule(
            protocol="1", source="0.0.0.0/0", description="ICMP path MTU"
        )
    )
    retry(
        lambda: net.update_security_list(
            vcn.default_security_list_id,
            oci.core.models.UpdateSecurityListDetails(
                ingress_security_rules=ingress,
                egress_security_rules=[
                    oci.core.models.EgressSecurityRule(
                        protocol="all", destination="0.0.0.0/0", description="allow all outbound"
                    )
                ],
            ),
        ).data,
        what="update security list",
    )

    subnet_name = f"{PREFIX}-subnet"
    subnets = retry(
        lambda: net.list_subnets(compartment_id=compartment, vcn_id=vcn.id).data,
        what="list subnets",
    )
    subnet = find(subnets, subnet_name)
    if subnet:
        print(f"  subnet         reuse  {subnet.display_name}")
    else:
        print(f"  subnet         create {subnet_name}")
        subnet = retry(
            lambda: net.create_subnet(
                oci.core.models.CreateSubnetDetails(
                    compartment_id=compartment,
                    vcn_id=vcn.id,
                    cidr_block=SUBNET_CIDR,
                    display_name=subnet_name,
                    dns_label="pwsub",
                    prohibit_public_ip_on_vnic=False,
                )
            ).data,
            what="create subnet",
        )
        wait_until(
            lambda: net.get_subnet(subnet.id).data,
            lambda s: s.lifecycle_state == "AVAILABLE",
            label="subnet",
            timeout=180,
        )

    return vcn.id, subnet.id


def newest_ubuntu(compute, compartment: str, spec: dict) -> str:
    """Newest Ubuntu 24.04 image matching the shape's architecture."""
    images = retry(
        lambda: compute.list_images(
            compartment_id=compartment,
            operating_system="Canonical Ubuntu",
            operating_system_version="24.04",
            shape=spec["shape"],
            sort_by="TIMECREATED",
            sort_order="DESC",
        ).data,
        what="list images",
    )
    # Prefer the full image over -Minimal: Minimal omits packages the Docker
    # install script expects and the saving is irrelevant on a 47 GB boot disk.
    full = [i for i in images if "Minimal" not in i.display_name]
    chosen = (full or images)[0]
    print(f"  image          {chosen.display_name}")
    return chosen.id


def launch(compute, net, compartment: str, subnet_id: str, spec: dict, ads: list) -> object:
    """Launch the instance, trying each availability domain in turn."""
    name = f"{PREFIX}-host"
    existing = find(
        retry(
            lambda: compute.list_instances(compartment_id=compartment).data,
            what="list instances",
        ),
        name,
    )
    if existing:
        print(f"  instance       reuse  {existing.display_name} ({existing.lifecycle_state})")
        return existing

    image_id = newest_ubuntu(compute, compartment, spec)
    metadata = {"ssh_authorized_keys": ssh_public_key()}

    shape_config = None
    if spec["shape"].endswith(".Flex"):
        shape_config = oci.core.models.LaunchInstanceShapeConfigDetails(
            ocpus=spec["ocpus"], memory_in_gbs=spec["memory_gb"]
        )

    capacity_errors = []
    for ad in ads:
        print(f"  instance       trying {spec['shape']} in {ad}")
        details = oci.core.models.LaunchInstanceDetails(
            compartment_id=compartment,
            availability_domain=ad,
            display_name=name,
            shape=spec["shape"],
            shape_config=shape_config,
            source_details=oci.core.models.InstanceSourceViaImageDetails(
                image_id=image_id, boot_volume_size_in_gbs=50
            ),
            create_vnic_details=oci.core.models.CreateVnicDetails(
                subnet_id=subnet_id, assign_public_ip=True
            ),
            metadata=metadata,
        )
        try:
            return compute.launch_instance(details).data
        except oci.exceptions.ServiceError as exc:
            if exc.code in ("OutOfHostCapacity", "InternalError"):
                print(f"                 no capacity in {ad}")
                capacity_errors.append(ad)
                continue
            raise SystemExit(f"launch failed: {exc.code} — {exc.message}") from exc

    raise SystemExit(
        f"\nNo capacity for {spec['shape']} in any availability domain "
        f"({', '.join(capacity_errors)}).\n\n"
        "This is the normal free-tier experience for the ARM shape, not a fault.\n"
        "Options:\n"
        "  * re-run this script later — capacity frees up irregularly\n"
        "  * python infra/provision.py --micro   (AMD, always available,\n"
        "    but 1 GB RAM is tight for numpy + scipy + OpenCV)"
    )


def public_ip(compute, net, compartment: str, instance_id: str) -> str:
    attachments = retry(
        lambda: compute.list_vnic_attachments(
            compartment_id=compartment, instance_id=instance_id
        ).data,
        what="list vnic attachments",
    )
    for attachment in attachments:
        vnic = retry(lambda a=attachment: net.get_vnic(a.vnic_id).data, what="get vnic")
        if vnic.public_ip:
            return vnic.public_ip
    raise SystemExit("Instance has no public IP")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--micro", action="store_true", help="Use the AMD micro shape.")
    parser.add_argument("--show", action="store_true", help="Report state, change nothing.")
    args = parser.parse_args()

    config = load_config()
    compartment = config["tenancy"]  # a fresh tenancy has no sub-compartments
    identity = oci.identity.IdentityClient(config)
    compute = oci.core.ComputeClient(config)
    net = oci.core.VirtualNetworkClient(config)

    if args.show:
        instances = retry(
            lambda: compute.list_instances(compartment_id=compartment).data,
            what="list instances",
        )
        live = [i for i in instances if not i.lifecycle_state.startswith("TERMINAT")]
        print(f"instances: {len(live)}")
        for i in live:
            print(f"  {i.display_name:<24} {i.shape:<24} {i.lifecycle_state}")
            if i.lifecycle_state == "RUNNING":
                print(f"    ip: {public_ip(compute, net, compartment, i.id)}")
        return 0

    spec = MICRO if args.micro else ARM
    print(f"region  : {config['region']}")
    print(f"shape   : {spec['shape']}  ({spec['ocpus']} OCPU, {spec['memory_gb']} GB)\n")

    print("network:")
    _, subnet_id = networking(net, compartment)

    ads = [
        a.name
        for a in retry(
            lambda: identity.list_availability_domains(compartment_id=compartment).data,
            what="list availability domains",
        )
    ]

    print("\ncompute:")
    instance = launch(compute, net, compartment, subnet_id, spec, ads)

    instance = wait_until(
        lambda: compute.get_instance(instance.id).data,
        lambda i: i.lifecycle_state in ("RUNNING", "TERMINATED", "STOPPED"),
        label="instance",
        timeout=900,
    )
    if instance.lifecycle_state != "RUNNING":
        raise SystemExit(f"Instance ended in state {instance.lifecycle_state}")

    ip = public_ip(compute, net, compartment, instance.id)

    state = {
        "region": config["region"],
        "compartment": compartment,
        "instance_id": instance.id,
        "instance_name": instance.display_name,
        "shape": instance.shape,
        "public_ip": ip,
        "ssh_user": "ubuntu",
        "ssh_key": str(Path.home() / ".ssh" / "oracle_particle_wave"),
        "hostname": f"{ip.replace('.', '-')}.sslip.io",
    }
    STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")

    print(f"\ninstance running at {ip}")
    print(f"  ssh -i ~/.ssh/oracle_particle_wave ubuntu@{ip}")
    print(f"  state written to {STATE_FILE.name}")
    print("\nNext: python infra/configure.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
