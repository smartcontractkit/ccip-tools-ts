import type { CreatedEvent, JsTransaction } from './clients/ledger-api/client.ts'
import { CantonIdentifier } from './types.ts'

export function getInterfaceCreatedEventFromTransaction(
  tx: JsTransaction,
  interfaceId: CantonIdentifier,
): CreatedEvent | undefined {
  // Loop over all events in tx, returning the first matching CreatedEvent
  for (const event of tx.events) {
    if ('CreatedEvent' in event) {
      if (!event.CreatedEvent.interfaceViews) {
        continue
      }
      for (const interfaceView of event.CreatedEvent.interfaceViews) {
        // Match the interface's identifier against the provided identifier
        // Other than for getCreatedEventFromTransaction, there's no package name to match against
        // For interfaces, the given identifier must be in package-id format
        const interfaceIdentifier = CantonIdentifier.fromString(interfaceView.interfaceId)
        if (
          interfaceIdentifier.packageId === interfaceId.packageId &&
          interfaceIdentifier.moduleName === interfaceId.moduleName &&
          interfaceIdentifier.entityName === interfaceId.entityName
        ) {
          return event.CreatedEvent
        }
      }
    }
  }
  return undefined
}

export function getCreatedEventFromTransaction(
  tx: JsTransaction,
  templateId?: CantonIdentifier,
): CreatedEvent | undefined {
  // Loop over all events in tx, returning the first matching CreatedEvent
  for (const event of tx.events) {
    if ('CreatedEvent' in event) {
      if (templateId) {
        // If an identifier is provided, match against the event
        const eventIdentifier = CantonIdentifier.fromString(event.CreatedEvent.templateId)
        if (
          eventIdentifier.packageId === templateId.packageId ||
          (`#${event.CreatedEvent.packageName}` === templateId.packageId && // Match both packageName and packageId against identifier
            eventIdentifier.moduleName === templateId.moduleName &&
            eventIdentifier.entityName === templateId.entityName)
        ) {
          return event.CreatedEvent
        }
      } else {
        // No identifier provided, return the first CreatedEvent we find
        return event.CreatedEvent as CreatedEvent
      }
    }
  }
  return undefined
}
