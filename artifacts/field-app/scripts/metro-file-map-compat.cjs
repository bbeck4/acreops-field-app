"use strict";

// Metro 0.83.8 removed the vulnerable image parser and changed file-map's
// "change" event shape. Expo SDK 54's CLI still reads the legacy eventsQueue
// property. Add that compatibility view without changing the new `changes`
// object that Metro itself consumes.
const path = require("node:path");
const EventEmitter = require("node:events");

const originalEmit = EventEmitter.prototype.emit;

EventEmitter.prototype.emit = function patchedEmit(eventName, changeEvent, ...args) {
  if (
    eventName === "change" &&
    changeEvent &&
    typeof changeEvent === "object" &&
    changeEvent.changes &&
    !changeEvent.eventsQueue
  ) {
    const rootDir =
      typeof changeEvent.rootDir === "string" ? changeEvent.rootDir : "";
    const eventsQueue = [];
    const append = (entries, type) => {
      if (!entries || typeof entries[Symbol.iterator] !== "function") return;
      for (const [canonicalPath, metadata] of entries) {
        eventsQueue.push({
          type,
          filePath: path.resolve(rootDir, canonicalPath),
          metadata,
        });
      }
    };
    append(changeEvent.changes.addedFiles, "add");
    append(changeEvent.changes.modifiedFiles, "change");
    append(changeEvent.changes.removedFiles, "delete");
    changeEvent.eventsQueue = eventsQueue;
  }
  return originalEmit.call(this, eventName, changeEvent, ...args);
};