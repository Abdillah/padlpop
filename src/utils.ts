// @ts-ignore
const Me = imports.misc.extensionUtils.getCurrentExtension();

import * as result from 'result';
import * as error from 'error';
// import * as log from 'log';

const { Gio, GLib, GObject, Meta } = imports.gi;
const { Ok, Err } = result;
const { Error } = error;

export function is_wayland(): boolean {
    return Meta.is_wayland_compositor();
}

export function block_signal(object: GObject.Object, signal: SignalID) {
    GObject.signal_handler_block(object, signal);
}

export function unblock_signal(object: GObject.Object, signal: SignalID) {
    GObject.signal_handler_unblock(object, signal);
}

export function read_to_string(path: string): result.Result<string, error.Error> {
    const file = Gio.File.new_for_path(path);
    try {
        const [ok, contents,] = file.load_contents(null);
        if (ok) {
            return Ok(imports.byteArray.toString(contents));
        } else {
            return Err(new Error(`failed to load contents of ${path}`));
        }
    } catch (e) {
        return Err(
            new Error(String(e))
                .context(`failed to load contents of ${path}`)
        );
    }
}

export function source_remove(id: SignalID): boolean {
    return GLib.source_remove(id);
}

export function exists(path: string): boolean {
    return Gio.File.new_for_path(path).query_exists(null);
}

/**
 * Parse the current background color's darkness 
 * https://stackoverflow.com/a/41491220 - the advanced solution
 * @param color - the RGBA or hex string value
 */
export function is_dark(color: string): boolean {
    // 'rgba(251, 184, 108, 1)' - pop orange!
    let color_val = "";
    let r = 255;
    let g = 255;
    let b = 255;

    // handle rgba(255,255,255,1.0) format
    if (color.indexOf('rgb') >= 0) {
        // starts with parsed value from Gdk.RGBA
        color = color.replace('rgba', 'rgb')
            .replace('rgb(', '')
            .replace(')', ''); // make it 255, 255, 255, 1
        // log.debug(`util color: ${color}`);
        let colors = color.split(',');
        r = parseInt(colors[0].trim());
        g = parseInt(colors[1].trim());
        b = parseInt(colors[2].trim());
    } else if (color.charAt(0) === '#') {
        color_val = color.substring(1, 7);
        r = parseInt(color_val.substring(0, 2), 16); // hexToR
        g = parseInt(color_val.substring(2, 4), 16); // hexToG
        b = parseInt(color_val.substring(4, 6), 16); // hexToB
    }

    let uicolors = [r / 255, g / 255, b / 255];
    let c = uicolors.map((col) => {
        if (col <= 0.03928) {
            return col / 12.92;
        }
        return Math.pow((col + 0.055) / 1.055, 2.4);
    });
    let L = (0.2126 * c[0]) + (0.7152 * c[1]) + (0.0722 * c[2]);
    return (L <= 0.179);
}

/** Utility function for running a process in the background and fetching its standard output as a string. */
export function async_process(argv: Array<string>, input = null, cancellable = null): Promise<string> {
    let flags = Gio.SubprocessFlags.STDOUT_PIPE

    if (input !== null)
        flags |= Gio.SubprocessFlags.STDIN_PIPE;

    let proc = new Gio.Subprocess({ argv, flags });
    proc.init(cancellable);

    return new Promise((resolve, reject) => {
        proc.communicate_utf8_async(input, cancellable, (proc: any, res: any) => {
            try {
                let bytes = proc.communicate_utf8_finish(res)[1];
                resolve(bytes.toString());
            } catch (e) {
                reject(e);
            }
        });
    });
}

export type AsyncIPC = {
    stdout: any,
    stdin: any,
}

export function async_process_ipc(argv: Array<string>): AsyncIPC | null {
    let [, pid, stdin_pipe, stdout_pipe, stderr_pipe] = GLib.spawn_async_with_pipes(
        null,
        argv,
        null,
        GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
        null
    )

    let stderr = new Gio.DataInputStream({
        base_stream: new Gio.UnixInputStream({
            fd: stderr_pipe,
            close_fd: true
        }),
        close_base_stream: true
    })

    stderr.read_line_async(0, null, (stream: any, res: any) => {
        try {
            let line = stream.read_line_finish_utf8(res)[0]
            if (line) {
                global.log(`ERR: ${line}`)
            }
        } catch (e) {
            global.log(`ERR CATCH: ${e}`)
        }
    })

    let stdin = new Gio.DataOutputStream({
        base_stream: new Gio.UnixOutputStream({
            fd: stdin_pipe,
            close_fd: true
        }),
        close_base_stream: true
    })

    let stdout = new Gio.DataInputStream({
        base_stream: new Gio.UnixInputStream({
            fd: stdout_pipe,
            close_fd: true
        }),
        close_base_stream: true
    })

    GLib.child_watch_add(GLib.PRIORITY_DEFAULT_IDLE, pid, (pid: number, status: any) => {
        global.log(`closing ${pid}: ${status}`)
        stdin.close(null)
        stdout.close(null)
        GLib.spawn_close_pid(pid)
    })

    return { stdin, stdout }
}