// @ts-ignore
const Me = imports.misc.extensionUtils.getCurrentExtension();

const { Clutter, Gio, GLib, Pango, St } = imports.gi;

import * as app_info from 'app_info'
import * as utils from 'utils'

import type { ShellWindow } from 'window';

const LOCAL_PLUGINS: string = GLib.get_home_dir() + "/.local/share/pop-shell/launcher/"
const SYSTEM_PLUGINS: string = "/usr/lib/pop-shell/launcher/"

export namespace Response {
    export interface Selection {
        id: number
        name: string
        description: null | string
        icon?: string
        content_type?: string
    }

    export interface Query {
        kind: "queried",
        selections: Array<Selection>
    }

    export interface Fill {
        kind: "fill",
        text: string
    }

    export interface Close {
        kind: "close"
    }

    export type Response = Query | Fill | Close;

    export function parse(input: string): null | Response {
        try {
            let object = JSON.parse(input) as Response
            switch (object.kind) {
                case "close":
                case "fill":
                case "queried":
                    return object;
            }
        } catch (e) {

        }

        return null
    }
}

export namespace Plugin {
    export interface Config {
        name: string
        description: string
        pattern: string
        exec: string
        icon: string
    }

    export function read(file: string): Config | null {
        global.log(`found plugin at ${file}`)
        try {
            let [ok, contents] = Gio.file_new_for_path(file)
                .load_contents(null)

            if (ok) return parse(imports.byteArray.toString(contents))
        } catch (e) {

        }

        return null
    }

    export function parse(input: string): Config | null {
        try {
            return JSON.parse(input)
        } catch (e) {
            return null
        }
    }

    export interface Source {
        config: Config
        proc: utils.AsyncIPC
        pattern: RegExp
    }

    export function listen(plugin: Plugin.Source): null | Response.Response {
        try {
            let [bytes,] = plugin.proc.stdout.read_line(null)
            return Response.parse(imports.byteArray.toString(bytes))
        } catch (e) {
            return null
        }
    }

    export function complete(plugin: Plugin.Source) {
        send(plugin, { event: "complete" })
    }

    export function query(plugin: Plugin.Source, value: string) {
        send(plugin, { event: "query", value })
    }

    export function quit(plugin: Plugin.Source) {
        send(plugin, { event: "quit" })
    }

    export function submit(plugin: Plugin.Source, id: number) {
        send(plugin, { event: "submit", id })
    }

    export function send(plugin: Plugin.Source, event: Object) {
        let string = JSON.stringify(event)

        plugin.proc.stdin.write_bytes(new GLib.Bytes(string + "\n"), null)
    }
}

export class LauncherService {
    private plugins: Array<Plugin.Source> = new Array()

    destroy() {
        for (const plugin of this.plugins) {
            Plugin.quit(plugin)
        }
    }

    constructor() {
        this.register_plugins()
    }

    query(query: string): null | [Plugin.Source, Response.Response] {
        let plugin = this.match_query(query)
        if (plugin) {
            Plugin.query(plugin, query)
            const res = Plugin.listen(plugin)
            return res ? [plugin, res] : null
        }

        return null
    }

    private register_plugins() {
        this.register_plugin_directory(SYSTEM_PLUGINS)
        this.register_plugin_directory(LOCAL_PLUGINS)
    }

    private register_plugin_directory(directory: string) {
        global.log(`checking for ${directory}`)
        let dir = Gio.file_new_for_path(directory)
        if (!dir.query_exists(null)) return

        global.log(`found ${directory}`)

        try {
            let entries = dir.enumerate_children('standard::*', Gio.FileQueryInfoFlags.NONE, null);
            let entry;

            while ((entry = entries.next_file(null)) !== null) {
                let name: string = entry.get_name()
                if (!name.endsWith('.json')) continue

                global.log(`found ${name}`)

                let path = directory + '/' + name
                let config = Plugin.read(path)
                if (!config) continue

                let exec = directory + '/' + config.exec

                global.log(`spawning process for ${exec}`)

                let proc = utils.async_process_ipc([exec])
                if (!proc) continue

                let pattern = new RegExp(config.pattern)

                global.log(`pushing plugin`)

                this.plugins.push({ config, proc, pattern })
            }
        } catch (e) {
            global.log(`error enumerating: ${e}`)
        }
    }

    private match_query(query: string): null | Plugin.Source {
        for (const plugin of this.plugins) {
            if (plugin.pattern.test(query)) return plugin
        }

        return null
    }
}

export interface IconByName {
    name: string
}

export interface IconByG {
    gicon: any
}

export interface IconWidget {
    widget: St.Widget
}

export type IconSrc = IconByName | IconByG | IconWidget

export interface AppOption {
    app: app_info.AppInfo
}

export interface WindowOption {
    window: ShellWindow
}

export interface PluginOption {
    plugin: Plugin.Source,
    id: number
}

export interface CalcOption {
    output: string
}

export type Identity = AppOption | WindowOption | PluginOption | CalcOption

export class SearchOption {
    title: string
    description: null | string
    id: Identity

    widget: St.Button

    constructor(title: string, description: null | string, category_icon: string, icon: IconSrc, icon_size: number, id: Identity) {
        this.title = title
        this.description = description
        this.id = id

        let cat_icon = new St.Icon({
            icon_name: category_icon,
            icon_size: icon_size / 2,
            style_class: "pop-shell-search-cat"
        })

        let app_icon
        if ("name" in icon) {
            app_icon = new St.Icon({
                icon_name: icon.name,
                icon_size
            })
        } else if ("gicon" in icon) {
            app_icon = new St.Icon({
                gicon: icon.gicon,
                icon_size
            })
        } else {
            app_icon = icon.widget
        }

        let layout = new St.BoxLayout({})

        cat_icon.set_y_align(Clutter.ActorAlign.CENTER);
        app_icon.set_y_align(Clutter.ActorAlign.CENTER);

        let label = new St.Label({
            text: title,
            styleClass: "pop-shell-search-label",
            y_align: Clutter.ActorAlign.CENTER
        });

        label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        layout.add_child(cat_icon)
        layout.add_child(app_icon)
        layout.add_child(label);

        this.widget = new St.Button({ styleClass: "pop-shell-search-element" });
        (this.widget as any).add_actor(layout);
    }
}
