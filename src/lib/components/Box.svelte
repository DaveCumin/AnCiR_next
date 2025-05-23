<script module>
	import Icon from '$lib/icon/Icon.svelte';
	import { core } from '$lib/core/theCore.svelte.js';

	/*
  export function moveBoxLayer(direction) {
    let boxes = thestate.boxes;
    let id = thestate.currentBoxID;
    // Clone the boxes to avoid modifying the original array
    const boxescopy = [...boxes];

    // Find the index of the box to move
    const index = boxescopy.findIndex((box) => box.id === id);
    if (index === -1) return; // Box not found, return original array

    // Calculate the new position
    const targetPos = boxescopy[index].layer + (direction === "down" ? 1 : -1);

    // Ensure the new position is within bounds
    if (targetPos < 0 || targetPos >= boxescopy.length) {
      return; // Position out of bounds, return original array
    }

    // Find the box currently at the target position
    const targetIndex = boxescopy.findIndex((box) => box.layer === targetPos);

    // Swap positionitions of the two boxes
    [boxescopy[index].layer, boxescopy[targetIndex].layer] = [
      boxescopy[targetIndex].layer,
      boxescopy[index].layer,
    ];

    // Return the updated array
    thestate.boxes = boxescopy;
  }*/
</script>

<script>
	// @ts-nocheck
	let { plot, children } = $props();

	function deleteBox() {
		//thestate.boxes = thestate.boxes.filter((box) => box.id !== id);
		show = false;
	}

	const borderOffset = 20;
	const topHeight = 0;
	const minWidth = 100;
	const minHeight = 100;

	let isResizing = false;
	let isDragging = $state(false);
	let dragcursor = $derived(isDragging ? 'grabbing' : 'grab');
	let initialX, initialY, initialMouseX, initialMouseY, initialWidth, initialHeight;

	//Drag logic -------------------------------------------------
	const startDrag = (event) => {
		isDragging = true;
		initialMouseX = event.clientX;
		initialMouseY = event.clientY;
		initialX = core.plots[0].x;
		initialY = core.plots[0].y;
		document.addEventListener('mousemove', doDrag);
		document.addEventListener('mouseup', stopDrag);
	};

	const doDrag = (event) => {
		const gridSize = 5;
		if (isDragging) {
			event.preventDefault();
			const deltaX = event.clientX - initialMouseX;
			const deltaY = event.clientY - initialMouseY;
			core.plots[0].x = initialX + deltaX;
			core.plots[0].y = initialY + deltaY;

			//snap to grid
			core.plots[0].x = Math.round(core.plots[0].x / gridSize) * gridSize;
			core.plots[0].y = Math.round(core.plots[0].y / gridSize) * gridSize;

			//Need to keep the div in the parent
			//left
			if (core.plots[0].x < 0) {
				core.plots[0].x = 0;
			}
			//top
			if (core.plots[0].y < 0) {
				core.plots[0].y = 0;
			}
			//the right and bottom will auto move in the div - it will grow with scrollbar
		}
	};

	const stopDrag = () => {
		isDragging = false;
		document.removeEventListener('mousemove', doDrag);
		document.removeEventListener('mouseup', stopDrag);
	};

	// Resize logic -------------------------------------------------
	const startResize = (event) => {
		isResizing = true;
		initialMouseX = event.clientX;
		initialMouseY = event.clientY;
		initialWidth = core.plots[0].width;
		initialHeight = core.plots[0].height;
		document.addEventListener('mousemove', doResize);
		document.addEventListener('mouseup', stopResize);
	};

	const doResize = (event) => {
		const gridSize = 5;
		if (isResizing) {
			event.preventDefault();
			const deltaX = event.clientX - initialMouseX;
			const deltaY = event.clientY - initialMouseY;
			core.plots[0].width = Math.max(
				minWidth,
				Math.round((initialWidth + deltaX) / gridSize) * gridSize
			);
			core.plots[0].height = Math.max(
				minHeight,
				Math.round((initialHeight + deltaY) / gridSize) * gridSize
			);
		}
	};

	const stopResize = () => {
		isResizing = false;
		document.removeEventListener('mousemove', doResize);
		document.removeEventListener('mouseup', stopResize);
	};
</script>

<div
	class="box"
	style="min-width:{minWidth}px; min-height:{minHeight}px; width:{plot.width}px; height:{plot.height}px; 
            background-color: pink; position: relative; 
                       border-radius: 8px; padding:3px; margin:3px;
            transform:translate3d({core.plots[0].x}px, {core.plots[0].y}px, 0px);
              position:absolute;"
	onclick={(e) => {
		//thestate.currentBoxID = id;
		e.stopPropagation();
	}}
>
	<div
		class="content"
		style=" position:relative; 
              overflow:auto; width:100%; height:100%;"
	>
		{@render children?.()}
	</div>

	<!-- Label-->
	<div class="boxlabel" style="top:-{borderOffset - 1}px;">
		<!-- <a>{text}</a> -->
	</div>

	<!-- LAYER CHANGE-->
	<div
		class="layerupbutton boxbutton"
		style="top:-{borderOffset - 1}px;"
		onclick={() => {
			moveBoxLayer('up');
		}}
	>
		<Icon name="layerUp" />
	</div>
	<!-- other layer change button-->
	<div
		class="layerdownbutton boxbutton"
		style="top:-{borderOffset - 1}px;"
		onclick={() => {
			moveBoxLayer('down');
		}}
	>
		<Icon name="layerDown" />
	</div>
	<!-- DELETE box -->
	<div
		class="deletebutton boxbutton"
		style="top:-{borderOffset - 1}px"
		onclick={() => {
			deleteBox();
		}}
	>
		<Icon name="deleteBox" width="100%" height="100%" color="var(--col-soft)" />
	</div>
	<!-- Drag Handle (a border around the box) -->
	<div
		class="drag-handle"
		style="width: calc({core.plots[0].width}px + {borderOffset * 2}px);
          height: calc({core.plots[0].height}px + {borderOffset * 2}px + {topHeight}px);
          left: -{borderOffset}px;
          top: -{borderOffset}px;
          cursor: {dragcursor};
          
          "
		onmousedown={startDrag}
	></div>

	<!-- Resize Handle -->
	<div
		class="resize-handle"
		onmousedown={startResize}
		style="bottom: calc(-{borderOffset}px - 4px);
      right: calc(-{borderOffset}px);
      
      "
	>
		<Icon name="resizeHandle" />
	</div>
</div>

<style>
	.drag-handle {
		position: absolute;
		bottom: -5px;
		left: -5px;
		border-radius: 8px;
		opacity: 0;
		transition: opacity 0.2s ease;
	}

	.resize-handle {
		position: absolute;
		cursor: nwse-resize;
		opacity: 0;
		transition: opacity 0.2s ease;
		width: 2em;
	}

	.boxbutton {
		position: absolute;
		opacity: 0;
		transition: opacity 0.2s ease;
		cursor: pointer;
		width: 1em;
	}
	.layerupbutton {
		right: 10px;
	}
	.layerdownbutton {
		right: calc(10px + 2px + 1em);
	}
	.deletebutton {
		right: calc(8px - 1em);
	}

	.boxlabel {
		position: absolute;
		left: 10px;
		top: 10px;
	}

	@keyframes fadeOpacity {
		0% {
			opacity: 0;
		}
		10% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
	}

	/* Apply fade-out when not hovering */
	div:hover > .resize-handle:not(:hover),
	div:hover > .drag-handle:not(:hover),
	div:hover > .boxbutton:not(:hover) {
		animation: fadeOpacity 2s ease forwards; /* Play fade-out animation */
	}

	.drag-handle:hover,
	.resize-handle:hover,
	.layerupbutton:hover,
	.layerdownbutton:hover,
	.deletebutton:hover {
		opacity: 1 !important; /* Ensure visibility */
		animation: none; /* Cancel the fade-out animation */
	}
</style>
