# Archived SillyTavern source patches

All patch files in this directory are historical review artifacts only. They are not part of the supported Host installation, active runtime transport, or CI setup. Do not apply them to any SillyTavern checkout.

The supported transport is the self-contained server plugin in `../server-plugin/`, mounted by the pinned SillyTavern plugin loader at `/api/plugins/logic-engine-extension-gateway`. The browser extension uses only this same-origin namespace. The old `/api/logic-engine/*` proxy routes and lifecycle source hooks are not used by the active Gateway.

The patches remain only to preserve historical evidence for earlier lifecycle experiments. Their presence does not indicate that they are supported or required.
