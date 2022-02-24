console.log("whyprofiler javascript loaded")

/* useful:
var cell = Jupyter.notebook.get_selected_cell();
*/

define([
    'require',
    'jquery',
    'moment',
    "underscore",
    'base/js/namespace',
    'base/js/events',
    'notebook/js/codecell'
], function (
    requirejs,
    $,
    moment,
    _,
    Jupyter,
    events,
    codecell
) {
    'use strict';
    const THRESHOLD_SECONDS = 1.0;
    const THRESHOLD_PERCENTAGE = 0.1;
    const GUTTER = "whyprofiler-codemirror-gutter";
    var log_prefix = '[whyprofiler]';
    var comm = null;
    var cell;
    var line_widgets = [];
    console.log(log_prefix, "js initialization");
    
    function initialize_comm_if_necessary() {
        console.log("initializing comm")
        if (comm != null) {
            console.log("comm already initialized")
            return;
        }

        console.log("actually initializing comm")
        comm = Jupyter.notebook.kernel.comm_manager.new_comm('whyprofiler', {'initialized': true})
        comm.on_msg(on_comm_message);
        console.log(log_prefix, "done initializing comm")
    }

    function get_css_class_for_severity(severity) {
        // TODO: convert float to number between 0 and 11
        return "whyprofiler-severity-" + severity;
    }
    
    function on_comm_message(msg) {
        console.log(log_prefix, "got comm message", msg.content.data);
        if (msg.content.data.msg_type == "analysis_ready") {
            console.log(log_prefix, "analysis ready");
            update_ui_for_cell(cell, msg.content.data)
        } else if (msg.content.data.msg_type == "fix_ready") {
            console.log(log_prefix, "fix ready");
            apply_fix(cell, msg.content.data);
        }
        
        console.log(log_prefix, "done handling comm message", msg.content.data);
    }

    function get_semgrep_issues_by_line(server_data) {
        return _.object(_.map(server_data.analysis.results, (res) => [res.end.line, [res.check_id, res.extra.message]]))
    }

    function intialize_and_cleanup_old_stuff(code_mirror) {
        code_mirror.setOption("gutters", [GUTTER]);
        _.each(_.range(code_mirror.lineCount()), (i)=>code_mirror.removeLineClass(i, "background"));
        _.each(_.range(code_mirror.lineCount()), (i)=>code_mirror.removeLineClass(i, "wrap"));
        _.each(line_widgets, (widget)=>widget.clear());
        line_widgets = [];
        code_mirror.clearGutter(GUTTER);
    }

    function request_fix(check_id, code_mirror, rerun_after_fix, previous_time) {
        console.log(log_prefix, "should apply fix", check_id);
        comm.send({
            msg_type : "apply_fix", 
            check_id : check_id,
            code: code_mirror.getDoc().getValue(),
            rerun_after_fix : rerun_after_fix,
            previous_time : previous_time,
        });
    }

    function apply_fix(cell, server_data) {
        console.log(log_prefix, "now applying fix", server_data);
        cell.code_mirror.getDoc().setValue(server_data.fixed_code);
        if (server_data.request.rerun_after_fix == true) {
            console.log("rerunning after fix");
            cell.metadata.fixed = true;
            cell.metadata.previous_time = server_data.request.previous_time;
            Jupyter.notebook.execute_selected_cells();
        }
    }

    function update_ui_for_cell(cell, server_data) {
        console.log(log_prefix, "starting to update ui for cell");

        let code_mirror = cell.code_mirror;
        intialize_and_cleanup_old_stuff(code_mirror);
        
        var semgrep_issues_by_line = get_semgrep_issues_by_line(server_data);
        var total_time = _.values(server_data.line_timing).reduce((a,b) => a+b, 0);
        
        if (cell.metadata.fixed == true) {
            let element = document.createElement("div");
            let previous_time = cell.metadata.previous_time;
            element.className = "whyprofiler-codemirror-successs"
            element.innerText = "Fix saved " + (previous_time - total_time).toFixed(1) + " seconds (runs " + Math.round((previous_time - total_time) / previous_time * 100) + "% faster)";
            let widget = code_mirror.addLineWidget(code_mirror.lineCount()-1, element);
            line_widgets.push(widget);
            cell.metadata.fixed = false;
            cell.metadata.previous_time = 0;
        }

        for (const [lineno_str, timing] of Object.entries(server_data.line_timing)) {
            var lineno = parseInt(lineno_str);
            var relative_time = timing / total_time;

            if (timing < THRESHOLD_SECONDS || relative_time < THRESHOLD_PERCENTAGE) {
                continue;
            }
            
            // severity is between 0 and 10
            var severity = Math.round(relative_time * 10).toString();
            console.log(log_prefix, "line", lineno, " has relative_time of", relative_time, "and severity", severity);
            code_mirror.addLineClass(lineno-1, "background", get_css_class_for_severity(severity));

            var gutter_element = document.createElement("div");
            gutter_element.innerText = timing.toFixed(1) + "s";
            gutter_element.className = get_css_class_for_severity(severity);
            code_mirror.setGutterMarker(lineno-1, GUTTER, gutter_element);

            if (_.has(semgrep_issues_by_line, lineno)) {
                let [check_id, check_description] = semgrep_issues_by_line[lineno]
                console.log(log_prefix, "found semgrep issue for line", lineno, "issue:", check_id)
                gutter_element.textContent = gutter_element.textContent + " *"
                let semgrep_element = document.createElement("div");
                semgrep_element.innerHTML = "<div class='whyprofiler-codemirror-fix-prefix'>Recommendation:</div> " + check_description;

                let apply_button = document.createElement("button");
                apply_button.innerText = "Apply Fix";
                apply_button.className = "whyprofiler-codemirror-fix-apply-btn";
                apply_button.addEventListener("click", () => request_fix(check_id, code_mirror, false, total_time));
                semgrep_element.appendChild(apply_button)

                let rerun_button = document.createElement("button");
                rerun_button.innerText = "Apply and Rerun";
                rerun_button.className = "whyprofiler-codemirror-fix-apply-btn";
                rerun_button.addEventListener("click", () => request_fix(check_id, code_mirror, true, total_time));
                semgrep_element.appendChild(rerun_button)

                let widget = code_mirror.addLineWidget(lineno-1, semgrep_element, { "className" : "whyprofiler-codemirror-fix" });
                code_mirror.addLineClass(lineno-1, "background", "whyprofiler-codemirror-fix-border");
                line_widgets.push(widget);
            }
        }

        code_mirror.refresh();
        console.log(log_prefix, "done updating ui for cell");
    }

    function execute_codecell_callback (evt, data) {
        console.log(log_prefix, "execute callback")
        initialize_comm_if_necessary()
        // TODO: send data here so we know how to map it back to the right cm?
        //comm.send({"execution_request" : true})
        cell = data.cell;
    }

    function add_css(url) {
        $('<link/>')
            .attr({
                rel: 'stylesheet',
                href: requirejs.toUrl(url),
                type: 'text/css'
            })
            .appendTo('head');
    }

    function load_jupyter_extension () {
        window.onbeforeunload = () => undefined;
        add_css('./whyprofiler.css');

        events.on('kernel_connected.Kernel', function() {
            console.log(log_prefix, "kernel connected")
            initialize_comm_if_necessary()
        });

        Jupyter.notebook.config.loaded.then(function do_stuff_with_config () {
            console.log(log_prefix, "starting loading callbacks");
            events.on('execute.CodeCell', execute_codecell_callback);
            console.log(log_prefix, "done loading callbacks");
        }).catch(function on_error (reason) {
            console.error(log_prefix, 'Error:', reason);
        });
    }

    return {
        load_jupyter_extension : load_jupyter_extension,
        load_ipython_extension : load_jupyter_extension
    };
});