# intrace

intrace is a multi-purpose and multi-location looking glass supporting a wide variety of query types through some easy configuration files (BIRD, MTR, Ping &amp; Traceroute pre-configured)

## Deploying a new intrace instance

- [Build Node.js from source](https://github.com/nodejs/node/blob/master/BUILDING.md) or [install pre-built .deb/.rpm packages](https://github.com/nodesource/distributions)
- Install git and tmux or screen on the looking glass server: `sudo apt-get install git-core tmux/screen` or `yum install git tmux/screen`
- Pull the latest master code from the repository: `git clone https://github.com/Fusl/intrace $HOME/intrace`
- Change directory to intrace: `cd $HOME/intrace`
- Copy the example configuration files: `cp config/caps.json.example caps.json; cp private.json.example private.json; cp probes.json.example probes.json; cp public.json.example public.json`
- Read through the [configiration reference](https://github.com/Fusl/intrace/wiki/intrace-API-and-config-reference#config-reference) and edit the `caps.json`, `private.json`, `probes.json` and `public.json` configuration files to your needs
- Install package dependencies: `npm install`
- Create a SSH keypair: `ssh-keygen -t ed25519`
- Copy the SSH public key to all probe servers: `ssh-copy-id -i $HOME/.ssh/id_ed25519.pub user@hostname`
- Make sure you can SSH into (all) probe servers: `ssh user@hostname`
- Make sure all required commands on all probe servers are installed: Default configuration with bird, traceroute, ping and mtr require the packages `bird`, `iputils-ping`, `traceroute` and `mtr-tiny` to be installed
- Start the looking glass daemon: `node lg.js`
- Open the looking glass frontend in your browser: `http://<ip address>:<port number>/`
- Additional step: Stop the looking glass (CTRL+C) and start it within tmux or screen: `tmux -Lintrace -f /dev/null new-session 'node lg.js'` or `screen -amdS intrace 'node lg.js'`

## Upgrading an existing intrace instance

- Change directory to intrace: `cd $HOME/intrace`
- Pull all changes from the repository: `git pull`
- Stop and restart the currently running intrace instance: `tmux -Lintrace attach` or `screen -x intrace` to attach the tmux/screen, stop the looking glass (CTRL+C) and start it again within tmux or screen: `tmux -Lintrace -f /dev/null new-session 'node lg.js'` or `screen -amdS intrace 'node lg.js'`