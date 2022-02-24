import setuptools

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

setuptools.setup(
    name="whyprofiler",
    version="0.0.1",
    author="Natan Yellin",
    author_email="natan@robusta.dev",
    description="A hybrid profiler for Jupyter notebook",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/robusta-dev/whyprofiler",
    include_package_data = True,
    install_requires=["jupyter", "yappi", "semgrep"],
    zip_safe=False,
    packages=setuptools.find_packages(),
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
)