FROM jupyter/datascience-notebook

WORKDIR /app

COPY . .
COPY load_whyprofiler_on_startup.ipy /home/jovyan/.ipython/profile_default/startup/load_whyprofiler_on_startup.ipy
USER root

RUN chown jovyan -R /app
RUN chown jovyan -R /home/jovyan/.ipython
USER jovyan

RUN python setup.py install --user
RUN jupyter nbextension install --py whyprofiler --user
RUN jupyter nbextension enable --py whyprofiler --user
RUN jupyter serverextension enable --py whyprofiler --user
RUN chmod a+x /home/jovyan/.local/lib/python3.9/site-packages/semgrep-*/semgrep/bin/semgrep-core
ENV DOCKER_STACKS_JUPYTER_CMD notebook

EXPOSE 8888
