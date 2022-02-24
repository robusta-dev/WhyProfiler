import tempfile
import subprocess
import yappi
import json
import os
import sys
from contextlib import ExitStack
from warnings import warn

class whyprofiler:
    def __init__(self, ip):
        self.comm = None
        self.ipython = ip
        self.installed_packages = set()
    
    def get_semgrep_command(self, input_file, fix=False, check_id=None):
        rules_path = os.path.join(os.path.dirname(__file__), "static", "semgrep")
        if check_id is not None:
            rules_path = os.path.join(rules_path, check_id + ".yaml")

        cmd = [
            "python",
            "-m",
            "semgrep",
            "-f", rules_path,
            "--lang=py",
            "--error",
            "--json",
            "--disable-version-check",
            "--no-rewrite-rule-ids",
            input_file
        ]

        if fix:
            cmd.append("--autofix")

        return cmd


    def run_semgrep(self, code, fix=False, check_id=None):
        with ExitStack() as stack:
            # don't add directly to the ExitStack because on Windows we need to close the file earlier so that we can write to it
            with tempfile.NamedTemporaryFile(delete=False) as code_file:
                code_file.write(code.encode())
            stack.callback(lambda: os.remove(code_file.name))
            
            semgrep_cmd = self.get_semgrep_command(code_file.name, fix, check_id)
            result = subprocess.run(semgrep_cmd, capture_output=True, text=True)
            #print(result)
            data = json.loads(result.stdout)

            code_file = stack.enter_context(open(code_file.name, "r"))
            fixed_code = code_file.read()
            return data, fixed_code


    def apply_fix(self, code, check_id):
        data, fixed_code = self.run_semgrep(code, fix=True, check_id=check_id)
        requirements = data['results'][0]['extra']['metadata']['fix_installation']
        if requirements not in self.installed_packages:
            warn("installing " + requirements)
            self.ipython.run_line_magic('pip', f'install {requirements} --user')
            self.installed_packages.add(requirements)
        return data, fixed_code

    def pre_run_cell(self, info):
        if self.comm is None:
            return

        yappi.set_clock_type("wall")
        yappi.start()
        

    def post_run_cell(self, result):
        # TODO: capture stdout and stderr so that extension bugs don't leak their way out
        #print("post run cell")
        if self.comm is None:
            return
        
        yappi.stop()

        semgrep, _ = self.run_semgrep(result.info.raw_cell)

        timing = {}
        for stat in yappi.get_func_stats(filter_callback=lambda stat: stat.name == "<module>" and stat.ctx_name == "_MainThread"):
            timing[stat.lineno] = stat.ttot
        self.comm.send({
            "msg_type" : "analysis_ready", 
            "line_timing" : timing,
            "analysis" : semgrep
        })
        yappi.clear_stats() # is there a use for global statistics?


    def on_comm(self, comm, open_msg):
        # comm is the kernel Comm instance
        # msg is the comm_open message
        # TODO verify that self.comm is None or close old and replace with new? (can multiple commms all connect?)
        print("Comm opened with message", open_msg, "and commm", comm)
        self.comm = comm

        # Register handler for later messages
        @comm.on_msg
        def _recv(msg):
            content = msg['content']['data']
            # TODO: support multiple comms and use comm ids...
            # Use msg['content']['data'] for the data in the message
            if content['msg_type'] == "apply_fix":
                fix, fixed_code = self.apply_fix(content['code'], content['check_id'])
                comm.send({
                    'msg_type': 'fix_ready',
                    'request' : content,
                    'fix' : fix,
                    'fixed_code' : fixed_code
                })
            else:
                comm.send({
                    'msg_type': 'error_unknown_request',
                    'request' : content,
                })


def _jupyter_server_extension_paths():
    return [{
        "module": "whyprofiler"
    }]


# Jupyter Extension points
def _jupyter_nbextension_paths():
    return [dict(
        section="notebook",
        src="static",
        dest="whyprofiler",
        require="whyprofiler/index")]


def load_jupyter_server_extension(nbapp):
    nbapp.log.info("************************ jupyter server extension loaded")
    

def load_ipython_extension(ip):
    #print("************************* ipython extension loaded")
    ip.np = whyprofiler(ip)
    ip.events.register("pre_run_cell", ip.np.pre_run_cell)
    ip.events.register("post_run_cell", ip.np.post_run_cell)
    ip.kernel.comm_manager.register_target('whyprofiler', ip.np.on_comm)


def unload_ipython_extension(ip):
    ip.events.unregister("pre_run_cell", ip.np.pre_run_cell)
    ip.events.unregister("post_run_cell", ip.np.post_run_cell)
    ip.kernel.comm_manager.unregister_target('whyprofiler', ip.np.on_comm)
    del ip.np
