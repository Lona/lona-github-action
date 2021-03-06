import * as core from "@actions/core";
import { GitHub } from "@actions/github";
import JSZip from "jszip";
import klaw from "klaw";
import * as fs from "fs";
import * as path from "path";
import fetch from "node-fetch";

let github: GitHub;

const createDeploymentStatus = async ({
  state,
  description,
  environment_url,
  refName
}: {
  state: "failure" | "error" | "success";
  description: string;
  environment_url?: string;
  refName?: string;
}) => {
  try {
    const deploymentId = core.getState("deployment_id");
    const token = core.getInput("github_token");

    const { GITHUB_REPOSITORY } = process.env;

    if (deploymentId && GITHUB_REPOSITORY) {
      const deployment_id = parseInt(deploymentId);
      const [owner, repo] = GITHUB_REPOSITORY.split("/");

      if (!github) {
        github = new GitHub(token);
      }

      const deploymentURL = environment_url
        ? `${environment_url}/${refName}`
        : undefined;

      await github.repos.createDeploymentStatus({
        deployment_id,
        repo,
        owner,
        state,
        description,
        log_url: deploymentURL,
        environment_url: deploymentURL,
        auto_inactive: false,
        mediaType: {
          previews: ["ant-man-preview", "flash-preview"]
        }
      });
    }

    const deploymentProdId = core.getState("deployment_prod_id");
    if (deploymentProdId && GITHUB_REPOSITORY) {
      const deployment_id = parseInt(deploymentProdId);
      const [owner, repo] = GITHUB_REPOSITORY.split("/");

      await github.repos.createDeploymentStatus({
        deployment_id,
        repo,
        owner,
        state,
        description,
        log_url: environment_url,
        environment_url,
        auto_inactive: true,
        mediaType: {
          previews: ["ant-man-preview", "flash-preview"]
        }
      });
    }
  } catch (err) {}
};

async function run() {
  try {
    const deploymentId = core.getState("deployment_id");
    if (!deploymentId) {
      // we didn't completed the main step so bail out
      return;
    }

    const outputPath = core.getInput("output_folder");
    const uploadURL = core.getState("upload_url");

    const { GITHUB_REPOSITORY, GITHUB_SHA } = process.env;

    if (!GITHUB_REPOSITORY) {
      throw new Error("Missing GITHUB_REPOSITORY");
    }

    if (core.getInput("workflow_succeeded") !== "true") {
      await createDeploymentStatus({
        state: "error",
        description: "The workflow failed."
      });
      return;
    }

    core.info(`Zip the output folder`);
    const zip = new JSZip();
    for await (const file of klaw(outputPath)) {
      if (!file.stats.isDirectory()) {
        core.debug(`Add ${file.path} to archive`);
        zip.file(
          path.relative(path.resolve(outputPath), file.path),
          fs.createReadStream(file.path)
        );
      }
    }

    core.info("Upload the archive to Lona's servers to deploy it");
    const body = await zip.generateAsync({ type: "nodebuffer" });

    const res = await fetch(uploadURL, {
      method: "PUT",
      body,
      headers: {
        "Content-Type": "application/zip"
      }
    });

    if (!res.ok) {
      core.debug(await res.text());
      throw new Error("Upload failed");
    }

    await createDeploymentStatus({
      state: "success",
      environment_url: core.getState("lona_deploy_url"),
      refName: `${core.getInput("ref_name") || GITHUB_SHA}`,
      description: "Lona website documentation deployed."
    });
  } catch (error) {
    await createDeploymentStatus({
      state: "failure",
      description: error.message
    });

    core.setFailed(error.message);
  }
}

run();
