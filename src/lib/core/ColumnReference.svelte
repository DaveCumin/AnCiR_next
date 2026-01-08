<script module>
	// @ts-nocheck
	import { getColumnById, Column } from '$lib/core/Column.svelte';
	import { core } from '$lib/core/core.svelte.js';

	/**
	 * ColumnReference - A lightweight wrapper for column references
	 * Instead of storing full Column objects, this stores only the refId
	 * and provides convenient methods to access the actual Column when needed.
	 *
	 * Benefits:
	 * - Smaller JSON serialization (just {refId})
	 * - Better separation of concerns
	 * - Easier to track and manage references
	 * - Reduced memory footprint
	 */
	export class ColumnReference {
		refId = $state(-1);

		constructor(refId = -1) {
			this.refId = refId;
		}

		/**
		 * Get the actual Column object being referenced
		 * @returns {Column|undefined} The Column object or undefined if not found
		 */
		get column() {
			if (this.refId === -1) return undefined;
			return getColumnById(this.refId);
		}

		/**
		 * Get the data from the referenced column
		 * @returns {Array} The data array, or empty array if column not found
		 */
		getData() {
			if (this.refId === -1) return [];
			const col = this.column;
			return col?.getData() ?? [];
		}

		/**
		 * Get the type of the referenced column
		 * @returns {string|undefined} The column type
		 */
		get type() {
			return this.column?.type;
		}

		/**
		 * Get the name of the referenced column
		 * @returns {string} The column name
		 */
		get name() {
			return this.column?.name ?? 'Unnamed';
		}

		/**
		 * Get hoursSinceStart from the referenced column
		 * @returns {Array} The hoursSinceStart array
		 */
		get hoursSinceStart() {
			return this.column?.hoursSinceStart ?? [];
		}

		/**
		 * Get binWidth from the referenced column
		 * @returns {number|undefined} The binWidth value
		 */
		get binWidth() {
			return this.column?.binWidth;
		}

		/**
		 * Check if this is a broken reference
		 * @returns {boolean} True if the reference is broken
		 */
		isBroken() {
			return this.refId === -1 || this.column === undefined;
		}

		/**
		 * Serialize to minimal JSON format
		 * @returns {Object} Just the refId
		 */
		toJSON() {
			return { refId: this.refId };
		}

		/**
		 * Create a ColumnReference from JSON
		 * @param {Object} json The JSON object
		 * @returns {ColumnReference} A new ColumnReference instance
		 */
		static fromJSON(json) {
			// Handle both {refId: X} format and direct Column objects for backward compatibility
			if (json?.refId !== undefined) {
				return new ColumnReference(json.refId);
			} else if (typeof json === 'number') {
				return new ColumnReference(json);
			} else if (json?.id !== undefined) {
				// Legacy format: full Column object serialized
				return new ColumnReference(json.id);
			}
			return new ColumnReference(-1);
		}

		/**
		 * Create a new Column in core.data that references the source column,
		 * allowing independent process management for plot data.
		 *
		 * @param {number} sourceRefId - The ID of the source column to reference
		 * @returns {ColumnReference} A new ColumnReference pointing to the newly created Column
		 */
		static createPlotColumn(sourceRefId) {
			// If sourceRefId is -1 or invalid, just return a broken reference
			if (sourceRefId === -1 || sourceRefId === undefined) {
				return new ColumnReference(-1);
			}

			// Create a new Column that references the source column
			const newColumn = new Column({ refId: sourceRefId });

			// Add it to core.data so processes can be added to it
			core.data.push(newColumn);

			// Return a ColumnReference to this new column
			return new ColumnReference(newColumn.id);
		}
	}
</script>
