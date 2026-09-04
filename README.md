# Silver Launcher

Local webapp replacement for multiple keyboard and mouse configuration tools.

## Supported Devices

### Mice

- Keychron M6
- ASUS ROG Harpe II ACE

### Keyboards

- Lofree Hyzen

## Development

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run dev
```

For a production-style local run:

```bash
bun run start
```

The server binds to `127.0.0.1`. It uses port `3000` by default, or the value
of `PORT`, and chooses another free loopback port if that port is occupied.

## Linux HID permissions

On Linux, `node-hid` needs permission to open the supported devices' `hidraw`
interfaces. Add a udev rule such as the following, then reload the rules and
reconnect the devices:

```udev
# /etc/udev/rules.d/70-silver-launcher.rules
KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="3434", TAG+="uaccess"
KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0b05", TAG+="uaccess"
KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="388d", TAG+="uaccess"
```

Then run:

```bash
sudo udevadm control --reload-rules
sudo udevadm trigger
```

The app keeps a detected device visible as access-denied when the rule is
missing, instead of hiding it.

## Local profile files

Profiles are stored offline under the platform configuration directory:

```text
silver-launcher/
  devices.json
  profiles/<model>/<slug>.json
```

Each profile contains its format version, model id, name, timestamps, and
device-specific settings. No profile data is sent over the network.
