# Running T4 Code in the Background

On a Linux host, T4 Code can run as a background service for your user. It starts when the machine
boots and keeps running after you log out.

> T4 distribution is not published yet. The commands below intentionally use the legacy `t3`
> package and `t3code.service` compatibility identifiers and should only be used with a matching
> local build or after independent T4 release infrastructure exists.

## Manage the Service

Install it with a matching compatible release:

```sh
npx t3@latest service install
```

Check whether it is installed:

```sh
npx t3@latest service status
```

Update or repair it:

```sh
npx t3@latest service update
```

Stop it and remove it from startup:

```sh
npx t3@latest service uninstall
```

Updating restarts T4 Code briefly. Let active agent work and terminal commands finish first.

## Using It with T4 Connect

T4 Connect may offer to install the service during setup so the host stays reachable after you log
out. This is only an onboarding shortcut: the service and T4 Connect are managed separately.

Signing out of T4 Connect does not remove the service. Use `t3 service uninstall` when you no longer
want T4 Code to start in the background.

The background service currently requires Linux with systemd.
