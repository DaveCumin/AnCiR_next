use scripting additions

-- ============================================================================
-- AnCiR Tutorial Screen Capture Script
-- ============================================================================
-- Records a tutorial walkthrough of AnCiR's features by automating mouse
-- movements, clicks, and keyboard input in Google Chrome.
--
-- Prerequisites:
--   - cliclick installed at /opt/homebrew/bin/cliclick
--   - Google Chrome open with AnCiR loaded (empty state, ready to import)
--   - The file dialog should be pre-configured to the correct folder
--   - Screen recording should be started before running this script
--
-- Emergency stop: press Cmd+. at any time to abort
-- ============================================================================

-- ———————— Configuration ————————
property CLICLICK : "/opt/homebrew/bin/cliclick"
property MOVE_STEPS_FAST : 10
property MOVE_STEPS_MEDIUM : 20
property MOVE_STEPS_SLOW : 30
property TYPE_MIN_DELAY : 0.06
property TYPE_MAX_DELAY : 0.18

-- ———————— smoothMoveTo handler ————————
on smoothMoveTo(targetX, targetY, steps, thenclick, thenClickWait)
	set currentPos to do shell script CLICLICK & " p"

	set AppleScript's text item delimiters to ","
	set startX to (text item 1 of currentPos) as integer
	set startY to (text item 2 of currentPos) as integer
	set AppleScript's text item delimiters to ""

	repeat with i from 1 to steps
		set progress to i / steps
		set curX to startX + ((targetX - startX) * progress)
		set curY to startY + ((targetY - startY) * progress)

		do shell script CLICLICK & " m:" & (curX as integer) & "," & (curY as integer)
		do shell script CLICLICK & " w:1"
	end repeat

	do shell script CLICLICK & " m:" & targetX & "," & targetY

	if thenclick is false then
		-- do nothing
	else
		do shell script CLICLICK & " w:" & thenClickWait
		do shell script CLICLICK & " " & thenclick & ":" & targetX & "," & targetY
	end if
end smoothMoveTo

-- ———————— getElementScreenOffset ————————
on getElementScreenOffset(selector, xPercent, yPercent)
	tell application "Google Chrome"
		tell active tab of front window
			set js to "(() => { " & ¬
				"const el = document.querySelector(" & quoted form of selector & "); " & ¬
				"if (!el) return 'NOT_FOUND'; " & ¬
				"const r = el.getBoundingClientRect(); " & ¬
				"const wx = window.screenX; " & ¬
				"const wy = window.screenY + (window.outerHeight - window.innerHeight); " & ¬
				"const xPct = " & xPercent & " / 100; " & ¬
				"const yPct = " & yPercent & " / 100; " & ¬
				"return Math.floor(wx + (r.left + r.width * xPct)) + ','  + Math.floor(wy + (r.top + r.height * yPct)); " & ¬
				"})();"

			set jsResult to execute javascript js

			if jsResult is "NOT_FOUND" then
				return false
			end if

			try
				set AppleScript's text item delimiters to ","
				set x to (text item 1 of jsResult) as integer
				set y to (text item 2 of jsResult) as integer
				set AppleScript's text item delimiters to ""
				return {x, y}
			on error
				return false
			end try
		end tell
	end tell
end getElementScreenOffset

on getElementScreenCenter(selector)
	return getElementScreenOffset(selector, 50, 50)
end getElementScreenCenter

-- ———————— goToElement ————————
on goToElement(cssSelector, steps, thenclick, thenClickWait)
	set elementXY to getElementScreenCenter(cssSelector)
	if elementXY is false then
		display notification "Element not found: " & cssSelector with title "Error"
		return false
	end if

	set targetX to item 1 of elementXY
	set targetY to item 2 of elementXY
	smoothMoveTo(targetX, targetY, steps, thenclick, thenClickWait)
	return true
end goToElement

on goToElementOffset(cssSelector, xOffset, yOffset, steps, thenclick, thenClickWait)
	set elementXY to getElementScreenOffset(cssSelector, xOffset, yOffset)
	if elementXY is false then
		display notification "Element not found: " & cssSelector with title "Error"
		return false
	end if

	set targetX to item 1 of elementXY
	set targetY to item 2 of elementXY
	smoothMoveTo(targetX, targetY, steps, thenclick, thenClickWait)
	return true
end goToElementOffset

-- ———————— resizeMoveElement ————————
on resizeMoveElement(selector, deltaX, deltaY)
	set handlePos to getElementScreenCenter(selector)
	if handlePos is false then
		display notification "Resize handle not found" with title "Error"
		return false
	end if

	set startX to item 1 of handlePos
	set startY to item 2 of handlePos
	set endX to startX + deltaX
	set endY to startY + deltaY

	smoothMoveTo(startX, startY, MOVE_STEPS_FAST, false, 0)
	delay 0.1

	do shell script CLICLICK & " dd:" & startX & "," & startY
	delay 0.05

	repeat with i from 1 to 20
		set progress to i / 20
		set curX to startX + (deltaX * progress)
		set curY to startY + (deltaY * progress)
		do shell script CLICLICK & " dm:" & (curX as integer) & "," & (curY as integer)
		delay 0.02
	end repeat

	do shell script CLICLICK & " du:" & endX & "," & endY
	delay 0.1
	return true
end resizeMoveElement

-- ———————— typeText ————————
on typeText(theText, minDelay, maxDelay)
	repeat with i from 1 to length of theText
		set oneChar to character i of theText
		if oneChar is return then
			tell application "System Events" to keystroke return
		else if oneChar is tab then
			tell application "System Events" to key code 48
		else
			tell application "System Events" to keystroke oneChar
		end if
		set randomDelay to (random number from minDelay to maxDelay)
		delay randomDelay
	end repeat
end typeText

-- ———————— setSelectValue ————————
-- Sets a <select> element's value via JavaScript instead of arrow keys.
-- This is robust to option order changes across versions.
on setSelectValue(selector, optionValue)
	tell application "Google Chrome"
		tell active tab of front window
			set js to "(() => { " & ¬
				"const sel = document.querySelector(" & quoted form of selector & "); " & ¬
				"if (!sel) return 'NOT_FOUND'; " & ¬
				"sel.value = " & quoted form of optionValue & "; " & ¬
				"sel.dispatchEvent(new Event('change', {bubbles: true})); " & ¬
				"sel.dispatchEvent(new Event('input', {bubbles: true})); " & ¬
				"return 'OK'; " & ¬
				"})();"
			return execute javascript js
		end tell
	end tell
end setSelectValue

-- ———————— setSelectByText ————————
-- Selects a <select> option by its visible text label.
on setSelectByText(selector, optionText)
	tell application "Google Chrome"
		tell active tab of front window
			set js to "(() => { " & ¬
				"const sel = document.querySelector(" & quoted form of selector & "); " & ¬
				"if (!sel) return 'NOT_FOUND'; " & ¬
				"const opt = Array.from(sel.options).find(o => o.text.toLowerCase() === " & quoted form of optionText & ".toLowerCase()); " & ¬
				"if (!opt) return 'OPTION_NOT_FOUND'; " & ¬
				"sel.value = opt.value; " & ¬
				"sel.dispatchEvent(new Event('change', {bubbles: true})); " & ¬
				"sel.dispatchEvent(new Event('input', {bubbles: true})); " & ¬
				"return 'OK'; " & ¬
				"})();"
			return execute javascript js
		end tell
	end tell
end setSelectByText

-- ———————— setInputValue ————————
-- Sets an input element's value via JavaScript.
on setInputValue(selector, theValue)
	tell application "Google Chrome"
		tell active tab of front window
			set js to "(() => { " & ¬
				"const el = document.querySelector(" & quoted form of selector & "); " & ¬
				"if (!el) return 'NOT_FOUND'; " & ¬
				"const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; " & ¬
				"nativeInputValueSetter.call(el, " & quoted form of theValue & "); " & ¬
				"el.dispatchEvent(new Event('input', {bubbles: true})); " & ¬
				"el.dispatchEvent(new Event('change', {bubbles: true})); " & ¬
				"return 'OK'; " & ¬
				"})();"
			return execute javascript js
		end tell
	end tell
end setInputValue

-- ———————— clickElement ————————
-- Clicks an element via JavaScript (useful for elements hard to reach with mouse).
on clickElement(selector)
	tell application "Google Chrome"
		tell active tab of front window
			set js to "(() => { " & ¬
				"const el = document.querySelector(" & quoted form of selector & "); " & ¬
				"if (!el) return 'NOT_FOUND'; " & ¬
				"el.click(); " & ¬
				"return 'OK'; " & ¬
				"})();"
			return execute javascript js
		end tell
	end tell
end clickElement

-- ———————— waitForElement ————————
-- Waits until an element appears in the DOM (up to maxWait seconds).
on waitForElement(selector, maxWait)
	set waited to 0
	repeat while waited < maxWait
		tell application "Google Chrome"
			tell active tab of front window
				set js to "document.querySelector(" & quoted form of selector & ") ? 'FOUND' : 'NOT_FOUND';"
				set result to execute javascript js
			end tell
		end tell
		if result is "FOUND" then return true
		delay 0.3
		set waited to waited + 0.3
	end repeat
	return false
end waitForElement

-- ———————— getNthSelectOptionValue ————————
-- Gets the value of the Nth option (1-based) in a select element.
on getNthSelectOptionValue(selector, n)
	tell application "Google Chrome"
		tell active tab of front window
			set js to "(() => { " & ¬
				"const sel = document.querySelector(" & quoted form of selector & "); " & ¬
				"if (!sel) return 'NOT_FOUND'; " & ¬
				"const idx = " & (n - 1) & "; " & ¬
				"if (idx >= sel.options.length) return 'OUT_OF_RANGE'; " & ¬
				"return sel.options[idx].value; " & ¬
				"})();"
			return execute javascript js
		end tell
	end tell
end getNthSelectOptionValue

-- ———————— selectColumnByName ————————
-- Selects a column in a ColumnSelector by matching partial text in the option label.
on selectColumnByName(selector, colName)
	tell application "Google Chrome"
		tell active tab of front window
			set js to "(() => { " & ¬
				"const sel = document.querySelector(" & quoted form of selector & "); " & ¬
				"if (!sel) return 'NOT_FOUND'; " & ¬
				"const opt = Array.from(sel.options).find(o => o.text.includes(" & quoted form of colName & ")); " & ¬
				"if (!opt) return 'OPTION_NOT_FOUND'; " & ¬
				"sel.value = opt.value; " & ¬
				"sel.dispatchEvent(new Event('change', {bubbles: true})); " & ¬
				"sel.dispatchEvent(new Event('input', {bubbles: true})); " & ¬
				"return 'OK'; " & ¬
				"})();"
			return execute javascript js
		end tell
	end tell
end selectColumnByName

-- ———————— selectNthOption ————————
-- Selects the Nth non-empty option (1-based) in a select element.
-- Useful for ColumnSelector where option values are dynamic IDs.
on selectNthOption(selector, n)
	tell application "Google Chrome"
		tell active tab of front window
			set js to "(() => { " & ¬
				"const sel = document.querySelector(" & quoted form of selector & "); " & ¬
				"if (!sel) return 'NOT_FOUND'; " & ¬
				"const opts = Array.from(sel.options).filter(o => o.value && o.value !== ''); " & ¬
				"const idx = " & (n - 1) & "; " & ¬
				"if (idx >= opts.length) return 'OUT_OF_RANGE'; " & ¬
				"sel.value = opts[idx].value; " & ¬
				"sel.dispatchEvent(new Event('change', {bubbles: true})); " & ¬
				"sel.dispatchEvent(new Event('input', {bubbles: true})); " & ¬
				"return 'OK'; " & ¬
				"})();"
			return execute javascript js
		end tell
	end tell
end selectNthOption

-- ============================================================================
-- TUTORIAL SECTIONS
-- ============================================================================

-- Give 2 seconds to switch to recording window
delay 2

-- ————————————————————————————————————————
-- SECTION 1: Import Data
-- ————————————————————————————————————————
on startAndImportData()
	-- Click the '+' button in the Data Sources heading
	goToElement(".display-list .heading .icon, .heading button .icon", MOVE_STEPS_FAST, "c", 1000)
	delay 0.1

	-- Click 'Import Data' in the dropdown
	goToElement(".dropdown-content .dropdown-action:first-child button", MOVE_STEPS_FAST, "c", 100)
	delay 0.5

	-- File dialog opens - select the first file
	tell application "System Events"
		key code 125 -- down arrow to select first file
		delay 0.5
		key code 36 -- enter to confirm file selection
	end tell

	-- Wait for file to be parsed and preview to appear
	waitForElement("#confirmImport", 10)
	delay 0.5

	-- Scroll down to see the preview
	tell application "System Events"
		repeat 3 times
			key code 125
			delay 0.1
		end repeat
	end tell

	-- Click 'Confirm Import'
	goToElement("#confirmImport", MOVE_STEPS_MEDIUM, "c", 10)

	-- Wait for upload to complete
	delay 2

	-- Rename the data table: double-click the name and type new name
	goToElement(".display-list .clps-container details summary .clps-title p", MOVE_STEPS_SLOW, "dc", 150)
	delay 0.2
	typeText("MyData", TYPE_MIN_DELAY, TYPE_MAX_DELAY)

	-- Expand the table to show columns (click the caret)
	goToElement(".display-list .clps-container details summary .clps-title-button .first-detail-title-icon", MOVE_STEPS_FAST, "c", 10)
	delay 0.5
end startAndImportData

-- ————————————————————————————————————————
-- SECTION 2: Create First Scatter Plot
-- ————————————————————————————————————————
on makeFirstScatter()
	-- Click the '+' button to add a plot (top-right area)
	goToElement(".newplotconstant", MOVE_STEPS_FAST, "c", 10)
	delay 0.1

	-- Click 'Create New Plot' (first option in the dropdown)
	goToElement(".dropdown-content .action:first-child button", MOVE_STEPS_FAST, "c", 50)
	delay 0.5

	-- Select 'scatterplot' from the plot type dropdown using JS
	setSelectValue("#plot-type", "scatterplot")
	delay 0.2

	-- Visually move to the dropdown so the viewer sees the selection
	goToElement("#plot-type", MOVE_STEPS_FAST, "c", 200)
	delay 0.5

	-- Tab to the name field and type a name
	tell application "System Events"
		key code 48 -- tab
	end tell
	delay 0.2
	typeText("test plot", TYPE_MIN_DELAY, TYPE_MAX_DELAY)
	delay 0.1

	-- Set x column: select the first available column (time data)
	-- The ColumnSelector selects are inside .import-container .preview-placeholder
	selectNthOption(".preview-placeholder select[name='columnSelect']:first-of-type", 1)
	delay 0.2
	goToElement(".preview-placeholder select[name='columnSelect']:first-of-type", MOVE_STEPS_FAST, "c", 100)
	delay 0.3

	-- Set y column: select the second available column
	selectNthOption(".preview-placeholder select[name='columnSelect']:last-of-type", 2)
	delay 0.2
	goToElement(".preview-placeholder select[name='columnSelect']:last-of-type", MOVE_STEPS_FAST, "c", 100)
	delay 1

	-- Click 'Make the scatterplot' button
	goToElement("#makePlot", MOVE_STEPS_FAST, "c", 250)
	delay 0.5

	-- Resize the plot (drag the resize handle)
	resizeMoveElement("section .resize-handle", 200, 50)
	delay 0.2

	-- Move the plot (drag the header)
	resizeMoveElement("section .plot-header", 50, 20)
	delay 0.3

	-- Hover over a data point on the scatter plot
	goToElementOffset("svg[id^='plot'] path", 67, 17, MOVE_STEPS_FAST, "m", 20)
	delay 0.5

	-- Hover over a y-axis label
	goToElement("svg[id^='plot'] g.axis-left g:nth-child(3) text", MOVE_STEPS_FAST, "m", 200)
	delay 0.5
end makeFirstScatter

-- ————————————————————————————————————————
-- SECTION 3: Filter Scatter by Y value
-- ————————————————————————————————————————
on filterScatterY()
	-- Open the column menu (3-dot icon on the y data column)
	-- The y data is the second column under the table
	goToElement(".display-list .clps-container details .second-clps:nth-child(3) .clps-title-button button:first-child", MOVE_STEPS_MEDIUM, "c", 150)
	delay 0.2

	-- Click 'FilterByOtherCol' from the process dropdown
	clickElement(".dropdown-content .dropdown-action:nth-child(3) button")
	delay 0.2

	-- Wait for the filter UI to appear
	waitForElement(".process .conditions select[name='columnSelect']", 5)
	delay 0.3

	-- Select the y column in the filter's ColumnSelector by name
	selectColumnByName(".process .conditions select[name='columnSelect']", "MyData")
	delay 0.3

	-- Set the operator to '<' (less than)
	setSelectValue(".process .conditions .operator-input select", "<")
	delay 0.2
	goToElement(".process .conditions .operator-input select", MOVE_STEPS_MEDIUM, "c", 200)
	delay 0.3

	-- Set the filter value to 20000
	goToElement(".process .conditions .second-level-condition:nth-child(2) input", MOVE_STEPS_MEDIUM, "dc", 250)
	delay 0.1
	typeText("20000", TYPE_MIN_DELAY, TYPE_MAX_DELAY)
	delay 0.5

	-- Press Enter/Tab to apply
	tell application "System Events"
		key code 36
	end tell
	delay 1
end filterScatterY

-- ————————————————————————————————————————
-- SECTION 4: Bin Data
-- ————————————————————————————————————————
on binData()
	-- Open the table's 3-dot menu
	goToElement(".display-list .clps-container details summary .clps-title-button button:first-child", MOVE_STEPS_MEDIUM, "c", 150)
	delay 0.2

	-- Click 'Add New Column'
	goToElement(".dropdown-content .dropdown-action:first-child button", MOVE_STEPS_FAST, "c", 100)
	delay 0.5

	-- Wait for MakeNewColumn modal
	waitForElement("dialog select", 5)
	delay 0.3

	-- Select 'BinnedData' from the process type dropdown
	setSelectByText("dialog select", "BinnedData")
	delay 0.2
	goToElement("dialog select", MOVE_STEPS_FAST, "c", 300)
	delay 0.5

	-- Set X column (time column) - first ColumnSelector in the BinnedData form
	selectNthOption("dialog select[name='columnSelect']:first-of-type", 1)
	delay 0.2
	goToElement("dialog select[name='columnSelect']:first-of-type", MOVE_STEPS_FAST, "c", 200)
	delay 0.3

	-- Set Y column - second ColumnSelector
	selectNthOption("dialog select[name='columnSelect']:last-of-type", 2)
	delay 0.2
	goToElement("dialog select[name='columnSelect']:last-of-type", MOVE_STEPS_FAST, "c", 200)
	delay 0.5

	-- Click 'Add these data' button
	waitForElement("#makeNewColumn", 5)
	delay 0.3
	goToElement("#makeNewColumn", MOVE_STEPS_MEDIUM, "c", 250)
	delay 1
end binData

-- ————————————————————————————————————————
-- SECTION 5: Smooth Data
-- ————————————————————————————————————————
on smoothData()
	-- Open the table's 3-dot menu again
	goToElement(".display-list .clps-container details summary .clps-title-button button:first-child", MOVE_STEPS_MEDIUM, "c", 150)
	delay 0.2

	-- Click 'Add New Column'
	goToElement(".dropdown-content .dropdown-action:first-child button", MOVE_STEPS_FAST, "c", 100)
	delay 0.5

	waitForElement("dialog select", 5)
	delay 0.3

	-- Select 'SmoothedData'
	setSelectByText("dialog select", "SmoothedData")
	delay 0.2
	goToElement("dialog select", MOVE_STEPS_FAST, "c", 300)
	delay 0.5

	-- Set X column (time)
	selectNthOption("dialog select[name='columnSelect']:first-of-type", 1)
	delay 0.2
	goToElement("dialog select[name='columnSelect']:first-of-type", MOVE_STEPS_FAST, "c", 200)
	delay 0.3

	-- Set Y column
	selectNthOption("dialog select[name='columnSelect']:last-of-type", 2)
	delay 0.2
	goToElement("dialog select[name='columnSelect']:last-of-type", MOVE_STEPS_FAST, "c", 200)
	delay 0.5

	-- Click 'Add these data'
	waitForElement("#makeNewColumn", 5)
	delay 0.3
	goToElement("#makeNewColumn", MOVE_STEPS_MEDIUM, "c", 250)
	delay 1
end smoothData

-- ————————————————————————————————————————
-- SECTION 6: Make an Actogram
-- ————————————————————————————————————————
on makeActogram()
	-- Click '+' to add a new plot
	goToElement(".newplotconstant", MOVE_STEPS_FAST, "c", 10)
	delay 0.1

	-- Click 'Create New Plot'
	goToElement(".dropdown-content .action:first-child button", MOVE_STEPS_FAST, "c", 50)
	delay 0.5

	-- Select 'actogram' from the plot type dropdown
	setSelectValue("#plot-type", "actogram")
	delay 0.2
	goToElement("#plot-type", MOVE_STEPS_FAST, "c", 200)
	delay 0.5

	-- Set time column (first ColumnSelector)
	selectNthOption(".preview-placeholder select[name='columnSelect']:first-of-type", 1)
	delay 0.2
	goToElement(".preview-placeholder select[name='columnSelect']:first-of-type", MOVE_STEPS_FAST, "c", 100)
	delay 0.3

	-- Set values column (second ColumnSelector)
	selectNthOption(".preview-placeholder select[name='columnSelect']:last-of-type", 2)
	delay 0.2
	goToElement(".preview-placeholder select[name='columnSelect']:last-of-type", MOVE_STEPS_FAST, "c", 100)
	delay 1

	-- Click 'Make the actogram'
	goToElement("#makePlot", MOVE_STEPS_FAST, "c", 250)
	delay 0.5

	-- Resize and position the actogram
	resizeMoveElement("section:nth-of-type(2) .resize-handle", 300, 150)
	delay 0.2
	resizeMoveElement("section:nth-of-type(2) .plot-header", -200, 100)
	delay 1
end makeActogram

-- ————————————————————————————————————————
-- SECTION 7: Add Phase Markers to Actogram
-- ————————————————————————————————————————
on addPhaseMarkers()
	-- Click the actogram plot to select it
	goToElement("section:nth-of-type(2) .plot-header", MOVE_STEPS_FAST, "c", 200)
	delay 0.5

	-- In the control panel (right side), go to Annotations tab
	goToElement(".control-tab:nth-child(3)", MOVE_STEPS_MEDIUM, "c", 200)
	delay 0.3

	-- Click 'Add Marker' button (if it exists in the annotations section)
	goToElement(".control-display button", MOVE_STEPS_MEDIUM, "c", 200)
	delay 0.5

	-- Set marker type to 'manual'
	setSelectByText(".control-display select", "Manual")
	delay 0.2
	goToElement(".control-display select", MOVE_STEPS_FAST, "c", 200)
	delay 0.5

	-- Click 'Add markers' button to enter marker placement mode
	waitForElement(".control-display button", 3)
	goToElement(".control-display button:last-of-type", MOVE_STEPS_FAST, "c", 200)
	delay 0.3

	-- Click on several days of the actogram to place markers
	-- These approximate positions on the actogram for marker placement
	repeat with dayNum from 1 to 5
		set yOffset to 10 + (dayNum * 15)
		goToElementOffset("svg[id^='plot']:last-of-type", 30, yOffset, MOVE_STEPS_FAST, "c", 300)
		delay 0.3
	end repeat

	-- Click 'Stop adding' to exit marker mode
	goToElement(".control-display button:last-of-type", MOVE_STEPS_FAST, "c", 200)
	delay 0.5
end addPhaseMarkers

-- ————————————————————————————————————————
-- SECTION 8: Make a Correlogram
-- ————————————————————————————————————————
on makeCorrelogram()
	-- Click '+' to add a new plot
	goToElement(".newplotconstant", MOVE_STEPS_FAST, "c", 10)
	delay 0.1

	-- Click 'Create New Plot'
	goToElement(".dropdown-content .action:first-child button", MOVE_STEPS_FAST, "c", 50)
	delay 0.5

	-- Select 'correlogram'
	setSelectValue("#plot-type", "correlogram")
	delay 0.2
	goToElement("#plot-type", MOVE_STEPS_FAST, "c", 200)
	delay 0.5

	-- Set time column
	selectNthOption(".preview-placeholder select[name='columnSelect']:first-of-type", 1)
	delay 0.2
	goToElement(".preview-placeholder select[name='columnSelect']:first-of-type", MOVE_STEPS_FAST, "c", 100)
	delay 0.3

	-- Set values column
	selectNthOption(".preview-placeholder select[name='columnSelect']:last-of-type", 2)
	delay 0.2
	goToElement(".preview-placeholder select[name='columnSelect']:last-of-type", MOVE_STEPS_FAST, "c", 100)
	delay 1

	-- Click 'Make the correlogram'
	goToElement("#makePlot", MOVE_STEPS_FAST, "c", 250)
	delay 0.5

	-- Resize and reposition
	resizeMoveElement("section:last-of-type .resize-handle", 200, 50)
	delay 0.2
	resizeMoveElement("section:last-of-type .plot-header", 100, -150)
	delay 1
end makeCorrelogram

-- ————————————————————————————————————————
-- SECTION 9: Make a Periodogram
-- ————————————————————————————————————————
on makePeriodogram()
	goToElement(".newplotconstant", MOVE_STEPS_FAST, "c", 10)
	delay 0.1

	goToElement(".dropdown-content .action:first-child button", MOVE_STEPS_FAST, "c", 50)
	delay 0.5

	-- Select 'periodogram'
	setSelectValue("#plot-type", "periodogram")
	delay 0.2
	goToElement("#plot-type", MOVE_STEPS_FAST, "c", 200)
	delay 0.5

	-- Set time column
	selectNthOption(".preview-placeholder select[name='columnSelect']:first-of-type", 1)
	delay 0.2
	goToElement(".preview-placeholder select[name='columnSelect']:first-of-type", MOVE_STEPS_FAST, "c", 100)
	delay 0.3

	-- Set values column
	selectNthOption(".preview-placeholder select[name='columnSelect']:last-of-type", 2)
	delay 0.2
	goToElement(".preview-placeholder select[name='columnSelect']:last-of-type", MOVE_STEPS_FAST, "c", 100)
	delay 1

	-- Click 'Make the periodogram'
	goToElement("#makePlot", MOVE_STEPS_FAST, "c", 250)
	delay 0.5

	-- Resize and reposition
	resizeMoveElement("section:last-of-type .resize-handle", 200, 80)
	delay 0.2
	resizeMoveElement("section:last-of-type .plot-header", -300, 100)
	delay 1
end makePeriodogram

-- ————————————————————————————————————————
-- SECTION 10: Fourier Analysis (FFT)
-- ————————————————————————————————————————
on makeFourierAnalysis()
	goToElement(".newplotconstant", MOVE_STEPS_FAST, "c", 10)
	delay 0.1

	goToElement(".dropdown-content .action:first-child button", MOVE_STEPS_FAST, "c", 50)
	delay 0.5

	-- Select 'fft'
	setSelectValue("#plot-type", "fft")
	delay 0.2
	goToElement("#plot-type", MOVE_STEPS_FAST, "c", 200)
	delay 0.5

	-- Set time column
	selectNthOption(".preview-placeholder select[name='columnSelect']:first-of-type", 1)
	delay 0.2
	goToElement(".preview-placeholder select[name='columnSelect']:first-of-type", MOVE_STEPS_FAST, "c", 100)
	delay 0.3

	-- Set values column
	selectNthOption(".preview-placeholder select[name='columnSelect']:last-of-type", 2)
	delay 0.2
	goToElement(".preview-placeholder select[name='columnSelect']:last-of-type", MOVE_STEPS_FAST, "c", 100)
	delay 1

	-- Click 'Make the fft'
	goToElement("#makePlot", MOVE_STEPS_FAST, "c", 250)
	delay 0.5

	-- Resize and reposition
	resizeMoveElement("section:last-of-type .resize-handle", 200, 80)
	delay 0.2
	resizeMoveElement("section:last-of-type .plot-header", -100, -200)
	delay 1
end makeFourierAnalysis

-- ————————————————————————————————————————
-- SECTION 11: Cosinor Analysis
-- ————————————————————————————————————————
on doCosinorAnalysis()
	-- Open the table's 3-dot menu
	goToElement(".display-list .clps-container details summary .clps-title-button button:first-child", MOVE_STEPS_MEDIUM, "c", 150)
	delay 0.2

	-- Click 'Add New Column'
	goToElement(".dropdown-content .dropdown-action:first-child button", MOVE_STEPS_FAST, "c", 100)
	delay 0.5

	waitForElement("dialog select", 5)
	delay 0.3

	-- Select 'Cosinor'
	setSelectByText("dialog select", "Cosinor")
	delay 0.2
	goToElement("dialog select", MOVE_STEPS_FAST, "c", 300)
	delay 0.5

	-- Set X column (time)
	selectNthOption("dialog select[name='columnSelect']:first-of-type", 1)
	delay 0.2
	goToElement("dialog select[name='columnSelect']:first-of-type", MOVE_STEPS_FAST, "c", 200)
	delay 0.3

	-- Set Y column
	selectNthOption("dialog select[name='columnSelect']:last-of-type", 2)
	delay 0.2
	goToElement("dialog select[name='columnSelect']:last-of-type", MOVE_STEPS_FAST, "c", 200)
	delay 0.3

	-- Set number of cosine curves to 1
	setInputValue("dialog input[type='number']", "1")
	delay 0.2
	goToElement("dialog input[type='number']", MOVE_STEPS_FAST, "c", 300)
	delay 0.5

	-- Click 'Add these data'
	waitForElement("#makeNewColumn", 5)
	delay 0.3
	goToElement("#makeNewColumn", MOVE_STEPS_MEDIUM, "c", 250)
	delay 1

	-- Now plot the cosinor fit on top of the scatter plot
	-- Select the scatter plot
	goToElement("section:first-of-type .plot-header", MOVE_STEPS_FAST, "c", 200)
	delay 0.5

	-- Go to the Data tab in the control panel
	goToElement(".control-tab:nth-child(2)", MOVE_STEPS_FAST, "c", 200)
	delay 0.3

	-- Scroll to the bottom of the control panel to find add-data options
	-- and add the cosinor fit as a second data series
	delay 1
end doCosinorAnalysis

-- ============================================================================
-- RUN ALL SECTIONS
-- ============================================================================
startAndImportData()
makeFirstScatter()
filterScatterY()
binData()
smoothData()
makeActogram()
addPhaseMarkers()
makeCorrelogram()
makePeriodogram()
makeFourierAnalysis()
doCosinorAnalysis()
