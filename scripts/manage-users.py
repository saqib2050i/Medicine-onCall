#!/usr/bin/env python3
"""manage-users.py — create/update/list/remove login users for the OnCall
auth service. Passwords are hashed with scrypt; only the salt + hash are
stored (in <data>/users.json), never the plaintext.

Run it inside the container (where the data volume is mounted), e.g.:

    docker exec -it oncall-guide python3 /app/manage-users.py add alice
    docker exec -it oncall-guide python3 /app/manage-users.py list
    docker exec -it oncall-guide python3 /app/manage-users.py passwd alice
    docker exec -it oncall-guide python3 /app/manage-users.py remove alice

The password is read interactively (hidden) or, for automation, from the
ONCALL_NEW_PASSWORD env var. Store no plaintext in shell history.

Users file location: $ONCALL_DATA_DIR/users.json (default /data/users.json).
"""

import argparse
import base64
import getpass
import hashlib
import json
import os
import re
import sys

DATA_DIR = os.environ.get("ONCALL_DATA_DIR", "/data")
USERS_FILE = os.path.join(DATA_DIR, "users.json")
# PBKDF2-HMAC-SHA256: always available in the stdlib (no OpenSSL scrypt needed),
# and a standard, well-vetted password hash. Iteration count per OWASP guidance.
ALGO = "pbkdf2_sha256"
ITERATIONS = 600000
DKLEN = 32
USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


def load():
    try:
        with open(USERS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError:
        sys.exit("error: %s is corrupt (not valid JSON)" % USERS_FILE)


def save(users):
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = USERS_FILE + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(users, f, indent=2, sort_keys=True)
        f.write("\n")
    os.replace(tmp, USERS_FILE)


def hash_password(password):
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITERATIONS, dklen=DKLEN)
    return {
        "algo": ALGO,
        "iterations": ITERATIONS,
        "salt": base64.b64encode(salt).decode("ascii"),
        "hash": base64.b64encode(dk).decode("ascii"),
    }


def read_new_password():
    env = os.environ.get("ONCALL_NEW_PASSWORD")
    if env:
        pw = env
        confirm = env
    else:
        pw = getpass.getpass("New password: ")
        confirm = getpass.getpass("Confirm password: ")
    if pw != confirm:
        sys.exit("error: passwords do not match")
    if len(pw) < 10:
        sys.exit("error: password must be at least 10 characters")
    return pw


def cmd_add(args, update_ok):
    if not USERNAME_RE.match(args.username):
        sys.exit("error: username must be 1-64 chars of letters, digits, . _ -")
    users = load()
    exists = args.username in users
    if exists and not update_ok:
        sys.exit("error: user '%s' already exists (use 'passwd' to change it)" % args.username)
    if not exists and update_ok:
        sys.exit("error: user '%s' does not exist (use 'add' to create it)" % args.username)
    users[args.username] = hash_password(read_new_password())
    save(users)
    print("%s user '%s'" % ("updated" if exists else "created", args.username))


def cmd_remove(args):
    users = load()
    if args.username not in users:
        sys.exit("error: user '%s' does not exist" % args.username)
    del users[args.username]
    save(users)
    print("removed user '%s'" % args.username)


def cmd_list(_args):
    users = load()
    if not users:
        print("(no users yet — add one with: manage-users.py add <name>)")
        return
    for name in sorted(users):
        print(name)


def main():
    ap = argparse.ArgumentParser(description="Manage OnCall login users.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("add", help="create a new user")
    a.add_argument("username")
    p = sub.add_parser("passwd", help="change an existing user's password")
    p.add_argument("username")
    r = sub.add_parser("remove", help="delete a user")
    r.add_argument("username")
    sub.add_parser("list", help="list usernames")
    args = ap.parse_args()

    if args.cmd == "add":
        cmd_add(args, update_ok=False)
    elif args.cmd == "passwd":
        cmd_add(args, update_ok=True)
    elif args.cmd == "remove":
        cmd_remove(args)
    elif args.cmd == "list":
        cmd_list(args)


if __name__ == "__main__":
    main()
