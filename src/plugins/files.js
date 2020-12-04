#!/usr/bin/gjs

const { GLib, Gio } = imports.gi;

/**
 * Request received by the Pop Shell launcher
 * @typedef {Object} LauncherRequest
 * @property {'submit' | 'query' | 'quit'} event
 * @property {string?} value
 * @property {number?} id
 */

/**
 * Selection for Pop Shell to display
 * @typedef {Object} Selection
 * @property {string} name
 * @property {string} icon
 * @property {string} description
 * @property {number} id
 */

const STDIN = new Gio.DataInputStream({ base_stream: new Gio.UnixInputStream({ fd: 0 }) })
const STDOUT = new Gio.DataOutputStream({ base_stream: new Gio.UnixOutputStream({ fd: 1 }) })

class App {
    constructor() {
        this.meta = new Array()
        this.selections = new Array()
        this.parent = ""
        this.last_query = ""
    }

    selection_path(selection, meta) {
        let text = this.parent
            + (this.parent.endsWith("/") ? "" : "/")
            + selection.name

        if (meta.directory) text += "/"

        return text
    }

    complete() {
        let text

        const selected = this.selections[0]
        const meta = this.meta[0]
        if (meta && selected) {
            text = this.selection_path(selected, meta)
        } else {
            text = this.last_query
        }

        const json = JSON.stringify({ kind: "fill", text })
        STDOUT.write_bytes(new GLib.Bytes(json + "\n"), null)
    }

    /**
     * Queries the plugin for results from this input
     * 
     * @param {string} input 
     */
    query(input) {
        this.last_query = input
        this.selections.splice(0)
        this.parent = GLib.path_get_dirname(input)

        let base = GLib.path_get_basename(input)

        if (this.parent.endsWith(base)) base = ""

        try {
            let dir = Gio.file_new_for_path(this.parent)
            if (dir.query_exists(null)) {
                let entries = dir.enumerate_children('standard::*', Gio.FileQueryInfoFlags.NONE, null);
                let entry;

                while ((entry = entries.next_file(null)) !== null) {
                    /** @type {string} */
                    let name = entry.get_name()

                    if (base.length !== 0 && name.indexOf(base) === -1) {
                        continue
                    }

                    let content_type = entry.get_content_type()

                    this.selections.push({
                        id: 0,
                        name,
                        description: null,
                        content_type
                    })

                    this.meta.push({
                        directory: entry.get_file_type() === Gio.FileType.DIRECTORY
                    })

                    if (this.selections.length === 10) break
                }
            }

            this.selections.sort((a, b) => {
                return a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0
            })

            let id = 0
            for (const v of this.selections) {
                v.id = id
                id += 1
            }
        } catch (e) {
            log(`QUERY ERROR: ${e}`)
        }

        // { "event": "query", "value": "/home/mmstick/.bash_logout/" }

        const json = JSON.stringify({ kind: "queried", selections: this.selections })
        STDOUT.write_bytes(new GLib.Bytes(json + "\n"), null)
    }

    /**
     * Applies an option that the user selected
     * 
     * @param {number} id
     */
    submit(id) {
        const selected = this.selections[id]
        const meta = this.meta[id]

        if (meta && selected) {
            const path = this.selection_path(selected, meta)
            try {
                GLib.spawn_command_line_async(`xdg-open ${path}`)
            } catch (e) {
                log(`xdg-open failed: ${e}`)
            }
        }
    }
}

function main() {
    /** @type {null | ByteArray} */
    let input_array

    /** @type {string} */
    let input_str

    /** @type {null | LauncherRequest} */
    let event_

    let app = new App()

    mainloop:
    while (true) {
        try {
            [input_array,] = STDIN.read_line(null)
        } catch (e) {
            break
        }

        input_str = imports.byteArray.toString(input_array)
        if ((event_ = parse_event(input_str)) !== null) {
            switch (event_.event) {
                case "complete":
                    app.complete()
                    break
                case "query":
                    if (event_.value) app.query(event_.value)
                    break
                case "quit":
                    break mainloop
                case "submit":
                    if (event_.id !== null) app.submit(event_.id)
            }
        }
    }

    log(`exiting plugin`)
}

/**
 * Parses an IPC event received from STDIN
 * @param {string} input
 * @returns {null | LauncherRequest}
 */
function parse_event(input) {
    log(`received: ${input}`)

    try {
        return JSON.parse(input)
    } catch (e) {
        log(`Input not valid JSON`)
        return null
    }
}

main()