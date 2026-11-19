#!/usr/bin/env python3
"""A pretend MPRIS player for the music activity tests: python3 fake-mpris-player.py <bus suffix> <json>.

<json> holds Identity, DesktopEntry, PlaybackStatus and Metadata (strings, string lists, ints).
It prints "ready" once it owns its name on the session bus.
"""
import json
import sys

import dbus
import dbus.service
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib

PLAYER = "org.mpris.MediaPlayer2.Player"
ROOT = "org.mpris.MediaPlayer2"


def variant(value):
    if isinstance(value, list):
        return dbus.Array([str(item) for item in value], signature="s")
    if isinstance(value, bool):
        return dbus.Boolean(value)
    if isinstance(value, int):
        return dbus.Int64(value)
    return dbus.String(value)


class Player(dbus.service.Object):
    def __init__(self, bus, spec):
        super().__init__(bus, "/org/mpris/MediaPlayer2")
        self.spec = spec

    @dbus.service.method(dbus.PROPERTIES_IFACE, in_signature="ss", out_signature="v")
    def Get(self, interface, name):
        return self.GetAll(interface)[name]

    @dbus.service.method(dbus.PROPERTIES_IFACE, in_signature="s", out_signature="a{sv}")
    def GetAll(self, interface):
        if interface == ROOT:
            return {"Identity": self.spec["Identity"], "DesktopEntry": self.spec.get("DesktopEntry", "")}
        if interface == PLAYER:
            metadata = dbus.Dictionary({key: variant(value) for key, value in self.spec["Metadata"].items()}, signature="sv")
            return dbus.Dictionary(
                {"PlaybackStatus": self.spec["PlaybackStatus"], "Metadata": metadata, "Volume": dbus.Double(0.5)},
                signature="sv",
            )
        raise dbus.exceptions.DBusException("org.freedesktop.DBus.Error.UnknownInterface")


DBusGMainLoop(set_as_default=True)
bus = dbus.SessionBus()
name = dbus.service.BusName(f"org.mpris.MediaPlayer2.{sys.argv[1]}", bus)
Player(bus, json.loads(sys.argv[2]))
print("ready", flush=True)
GLib.MainLoop().run()
