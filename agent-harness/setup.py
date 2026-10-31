from setuptools import setup, find_namespace_packages
from pathlib import Path

setup(
    name='cli-anything-twilightecho', version='0.1.0',
    description='Agent CLI for the real Twilight Echo application and music analysis engine',
    long_description=(Path(__file__).parent/'cli_anything/twilightecho/README.md').read_text(encoding='utf-8'),
    long_description_content_type='text/markdown',
    license='Apache-2.0',
    license_files=['CLI-ANYTHING-LICENSE'],
    packages=find_namespace_packages(include=['cli_anything.*']),
    package_data={'cli_anything.twilightecho': ['commands.json', 'skills/*.md', 'README.md', 'tests/TEST.md']},
    install_requires=['click>=8.1', 'prompt-toolkit>=3.0'],
    entry_points={'console_scripts': ['cli-anything-twilightecho=cli_anything.twilightecho.twilightecho_cli:main']},
    python_requires='>=3.10',
)
